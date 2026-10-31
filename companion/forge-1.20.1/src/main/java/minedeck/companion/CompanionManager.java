package minedeck.companion;

import java.io.IOException;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.regex.Pattern;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.player2.playerengine.PlayerEngineController;
import com.player2.playerengine.automaton.api.entity.LivingEntityInventory;
import com.player2.playerengine.tasks.base.Task;

import minedeck.companion.net.CompanionConfig;
import minedeck.companion.net.ControlServer;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.TagKey;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraftforge.fml.ModList;
import net.minecraftforge.fml.loading.FMLPaths;

/**
 * 执行 MineDeck 发来的指令。所有对世界的操作都在服务器主线程上做（网络线程只把指令转交过来）。
 *
 * <p>原型只管一个伙伴。动作清单是固定的：spawn、despawn、status、collect、follow、goto、give、stop、say。
 * collect / follow / goto / give 翻译成 PlayerEngine 自己的指令（get / follow / goto / give）交给它执行，
 * 指令结束时发 task_finished 事件；collect 结束时数一下背包，看够不够数。
 */
final class CompanionManager implements ControlServer.Handler {

    private static final Pattern ITEM = Pattern.compile("[a-z0-9_.\\-]+(:[a-z0-9_./\\-]+)?");
    private static final Pattern PLAYER = Pattern.compile("[A-Za-z0-9_]{1,16}");
    private static final int MAX_COUNT = 36 * 64;
    /** null 也写出来（"companion":null），MineDeck 那边好判断。 */
    private static final Gson GSON = new GsonBuilder().serializeNulls().disableHtmlEscaping().create();

    private static CompanionManager instance;

    private final MinecraftServer server;
    private final String modVersion;
    private final String engineVersion;
    private final ControlServer control;

    // 以下只在服务器主线程上读写
    private UUID companionId;
    private TaskRun current;
    private long nextTaskId = 1;
    private int ticks;

    // 给网络线程、状态线程读的快照（主线程每秒更新）
    private volatile String companionsSnapshot = "[]";

    private CompanionManager(MinecraftServer server, String modVersion) {
        this.server = server;
        this.modVersion = modVersion;
        this.engineVersion = ModList.get().getModContainerById("playerengine")
                .map(c -> c.getModInfo().getVersion().toString()).orElse("?");
        this.control = new ControlServer(this, CompanionMod.LOG);
    }

    static void start(MinecraftServer server, String version) {
        CompanionManager m = new CompanionManager(server, version);
        instance = m;
        CompanionConfig cfg;
        try {
            cfg = CompanionConfig.load(FMLPaths.GAMEDIR.get());
        } catch (IOException e) {
            CompanionMod.LOG.error("读不了伙伴的配置文件", e);
            return;
        }
        if (!cfg.enabled) {
            CompanionMod.LOG.info("伙伴控制端口没有打开（{} 里 enabled=false）。服务器不是从 MineDeck 启动的话这是正常的", cfg.path);
            return;
        }
        if (cfg.problem != null) {
            CompanionMod.LOG.warn("伙伴配置有问题，控制端口不打开：{}（{}）", cfg.problem, cfg.path);
            return;
        }
        try {
            m.control.start(cfg);
        } catch (IOException e) {
            CompanionMod.LOG.error("打不开伙伴控制端口 127.0.0.1:{}：{}", cfg.port, e.toString());
        }
    }

    static void stop() {
        CompanionManager m = instance;
        instance = null;
        if (m != null) {
            m.control.close("服务器正在关闭");
        }
    }

    static void tick() {
        CompanionManager m = instance;
        if (m != null && ++m.ticks % 20 == 0) {
            m.refreshSnapshot();
        }
    }

    /** 伙伴实体第一次在服务端 tick 时调用：服务器重启后从存档里读回来的伙伴也能被接管。 */
    static void adopt(CompanionEntity e) {
        CompanionManager m = instance;
        if (m == null) {
            return;
        }
        if (m.companionId == null) {
            m.companionId = e.getUUID();
            CompanionMod.LOG.info("接管伙伴 {}（{}）", e.getName().getString(), e.getUUID());
        } else if (!m.companionId.equals(e.getUUID())) {
            CompanionMod.LOG.warn("发现第二个伙伴 {}（{}），原型只管一个，不理它", e.getName().getString(), e.getUUID());
        }
    }

    static void onDied(CompanionEntity e, DamageSource source) {
        CompanionManager m = instance;
        if (m == null || !e.getUUID().equals(m.companionId)) {
            return;
        }
        JsonObject ev = event("died");
        ev.addProperty("uuid", e.getUUID().toString());
        ev.addProperty("cause", source.getLocalizedDeathMessage(e).getString());
        m.control.event(GSON.toJson(ev));
    }

    static void onRemoved(CompanionEntity e, Entity.RemovalReason reason) {
        CompanionManager m = instance;
        if (m == null || !e.getUUID().equals(m.companionId)) {
            return;
        }
        if (m.current != null) {
            m.finishTask(m.current, "cancelled", "伙伴被移除了", e);
        }
        m.companionId = null;
        JsonObject ev = event("removed");
        ev.addProperty("uuid", e.getUUID().toString());
        ev.addProperty("reason", reason.name());
        m.control.event(GSON.toJson(ev));
        m.refreshSnapshot();
        CompanionMod.LOG.info("伙伴 {} 已移除（{}）", e.getName().getString(), reason);
    }

    // ---- ControlServer.Handler ----

    @Override
    public void onRequest(String json, ControlServer.Connection conn) {
        server.execute(() -> handle(json, conn));
    }

    @Override
    public String welcomeJson() {
        JsonObject o = new JsonObject();
        o.addProperty("mod", modVersion);
        o.addProperty("minecraft", server.getServerVersion());
        o.addProperty("loader", "forge");
        o.addProperty("playerEngine", engineVersion);
        o.add("companions", JsonParser.parseString(companionsSnapshot));
        return GSON.toJson(o);
    }

    @Override
    public String statusJson() {
        return "{\"companions\":" + companionsSnapshot + "}";
    }

    // ---- 指令 ----

    private static final class OpError extends RuntimeException {
        private static final long serialVersionUID = 1L;
        final String code;

        OpError(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private static final class TaskRun {
        final long id;
        final String op;
        final String command;
        final String item;
        final int want;
        /** 开始时背包里已经有几个：PlayerEngine 的 get N 是"再弄 N 个"，结束时按增加的数量判断够不够。 */
        final int before;
        final long startedAt = System.currentTimeMillis();
        boolean done;

        TaskRun(long id, String op, String command, String item, int want, int before) {
            this.id = id;
            this.op = op;
            this.command = command;
            this.item = item;
            this.want = want;
            this.before = before;
        }
    }

    private void handle(String json, ControlServer.Connection conn) {
        long id = -1;
        String op = "";
        try {
            JsonObject req = JsonParser.parseString(json).getAsJsonObject();
            id = req.has("id") ? req.get("id").getAsLong() : -1;
            op = str(req, "op");
            JsonObject res;
            switch (op) {
                case "spawn":
                    res = spawn(req);
                    break;
                case "despawn":
                    res = despawn();
                    break;
                case "status":
                    res = status();
                    break;
                case "collect": {
                    String item = item(req);
                    int count = count(req, "count");
                    res = startTask("collect", "get " + item + " " + count, item, count);
                    break;
                }
                case "follow":
                    res = startTask("follow", "follow " + onlinePlayer(req, "player"), null, 0);
                    break;
                case "goto":
                    res = startTask("goto", "goto " + integer(req, "x") + " " + integer(req, "y") + " " + integer(req, "z"),
                            null, 0);
                    break;
                case "give": {
                    String player = onlinePlayer(req, "player");
                    String item = item(req);
                    int count = count(req, "count");
                    res = startTask("give", "give " + player + " " + item + " " + count, null, 0);
                    break;
                }
                case "stop":
                    res = stopTask();
                    break;
                case "say":
                    res = say(req);
                    break;
                default:
                    throw new OpError("unknown_op", "不认识的指令：" + op);
            }
            res.addProperty("id", id);
            res.addProperty("ok", true);
            conn.response(GSON.toJson(res));
        } catch (OpError e) {
            conn.response(GSON.toJson(error(id, e.code, e.getMessage())));
        } catch (RuntimeException e) {
            CompanionMod.LOG.error("执行指令 {} 出错", op, e);
            conn.response(GSON.toJson(error(id, "internal", e.toString())));
        }
    }

    private JsonObject spawn(JsonObject req) {
        CompanionEntity existing = companion();
        if (existing != null) {
            throw new OpError("already_spawned", "已经有一个伙伴了：" + existing.getName().getString());
        }
        String name = req.has("name") ? str(req, "name") : "伙伴";
        if (name.isEmpty() || name.length() > 32) {
            throw new OpError("bad_args", "name 要有 1–32 个字符");
        }
        ServerLevel level = server.overworld();
        double x;
        double y;
        double z;
        if (req.has("near")) {
            ServerPlayer p = server.getPlayerList().getPlayerByName(str(req, "near"));
            if (p == null) {
                throw new OpError("no_player", "玩家不在线：" + str(req, "near"));
            }
            level = p.serverLevel();
            x = p.getX() + 1;
            y = p.getY();
            z = p.getZ();
        } else if (req.has("x") && req.has("z")) {
            x = integer(req, "x") + 0.5;
            z = integer(req, "z") + 0.5;
            y = req.has("y") ? integer(req, "y") : surface(level, x, z);
        } else {
            BlockPos s = level.getSharedSpawnPos();
            x = s.getX() + 0.5;
            z = s.getZ() + 0.5;
            y = surface(level, x, z);
        }
        CompanionEntity e = CompanionMod.COMPANION.get().create(level);
        if (e == null) {
            throw new OpError("spawn_failed", "创建伙伴实体失败");
        }
        e.moveTo(x, y, z, 0.0F, 0.0F);
        e.setCustomName(Component.literal(name));
        e.setCustomNameVisible(true);
        if (!level.addFreshEntity(e)) {
            throw new OpError("spawn_failed", "伙伴没能加进世界");
        }
        companionId = e.getUUID();
        refreshSnapshot();
        JsonObject info = companionJson(e, false);
        JsonObject ev = event("spawned");
        ev.add("companion", info);
        control.event(GSON.toJson(ev));
        CompanionMod.LOG.info("伙伴 {} 已刷出：{} {} {}（{}）", name, fmt(x), fmt(y), fmt(z), level.dimension().location());
        JsonObject res = new JsonObject();
        res.add("companion", info);
        return res;
    }

    private JsonObject despawn() {
        CompanionEntity e = requireCompanion();
        String uuid = e.getUUID().toString();
        e.discard();
        JsonObject res = new JsonObject();
        res.addProperty("removed", uuid);
        return res;
    }

    private JsonObject status() {
        JsonObject res = new JsonObject();
        CompanionEntity e = companion();
        res.add("companion", e == null ? null : companionJson(e, true));
        res.add("task", current == null ? null : taskJson(current));
        return res;
    }

    private JsonObject say(JsonObject req) {
        CompanionEntity e = requireCompanion();
        String text = str(req, "text");
        if (text.isEmpty() || text.length() > 256) {
            throw new OpError("bad_args", "text 要有 1–256 个字符");
        }
        server.getPlayerList().broadcastSystemMessage(
                Component.literal("<" + e.getName().getString() + "> " + text), false);
        return new JsonObject();
    }

    private JsonObject stopTask() {
        CompanionEntity e = requireCompanion();
        PlayerEngineController c = e.controller();
        JsonObject res = new JsonObject();
        if (current != null) {
            res.addProperty("stopped", current.id);
            finishTask(current, "cancelled", "MineDeck 让它停下", e);
        }
        if (c != null) {
            c.stop();
        }
        return res;
    }

    /** 把指令交给 PlayerEngine。语法错（比如物品名不认识）当场回错误；开始执行后结束时发 task_finished。 */
    private JsonObject startTask(String op, String command, String item, int want) {
        CompanionEntity e = requireCompanion();
        PlayerEngineController c = e.controller();
        if (c == null) {
            throw new OpError("not_ready", "伙伴还没准备好（PlayerEngine 控制器还没创建），稍后再试");
        }
        if (current != null && !current.done) {
            finishTask(current, "superseded", "被新的指令替换", e);
        }
        TaskRun t = new TaskRun(nextTaskId++, op, command, item, want, item == null ? 0 : countItem(e, item));
        String[] syncError = new String[1];
        boolean[] calling = {true};
        String line = c.getCommandExecutor().getCommandPrefix() + command;
        c.getCommandExecutor().execute(line,
                () -> { },
                () -> later(() -> onTaskEnd(t, null, null)),
                note -> later(() -> onTaskEnd(t, null, note)),
                ex -> {
                    if (calling[0]) {
                        syncError[0] = ex.getMessage();
                    } else {
                        later(() -> onTaskEnd(t, ex.getMessage(), null));
                    }
                });
        calling[0] = false;
        if (syncError[0] != null) {
            t.done = true;
            throw new OpError("rejected", "PlayerEngine 不接受这条指令：" + syncError[0].trim());
        }
        current = t;
        JsonObject ev = event("task_started");
        ev.add("task", taskJson(t));
        control.event(GSON.toJson(ev));
        CompanionMod.LOG.info("任务 #{} 开始：{}", t.id, line);
        JsonObject res = new JsonObject();
        res.add("task", taskJson(t));
        return res;
    }

    private void later(Runnable r) {
        server.execute(r);
    }

    private void onTaskEnd(TaskRun t, String error, String note) {
        if (t.done) {
            return;
        }
        finishTask(t, error != null ? "failed" : "done", error != null ? error : note, companion());
    }

    private void finishTask(TaskRun t, String result, String detail, CompanionEntity e) {
        t.done = true;
        if (current == t) {
            current = null;
        }
        JsonObject ev = event("task_finished");
        ev.add("task", taskJson(t));
        if (t.item != null && e != null) {
            int have = countItem(e, t.item);
            int gained = have - t.before;
            ev.addProperty("have", have);
            ev.addProperty("gained", gained);
            ev.addProperty("want", t.want);
            if ("done".equals(result) && have >= 0 && gained < t.want) {
                result = "incomplete";
            }
        }
        ev.addProperty("result", result);
        if (detail != null && !detail.isBlank()) {
            ev.addProperty("detail", detail.trim());
        }
        ev.addProperty("seconds", (System.currentTimeMillis() - t.startedAt) / 1000.0);
        String json = GSON.toJson(ev);
        CompanionMod.LOG.info("任务 #{} 结束：{}", t.id, json);
        control.event(json);
    }

    // ---- 查询 ----

    private CompanionEntity companion() {
        if (companionId == null) {
            return null;
        }
        for (ServerLevel level : server.getAllLevels()) {
            Entity en = level.getEntity(companionId);
            if (en instanceof CompanionEntity c && c.isAlive()) {
                return c;
            }
        }
        return null;
    }

    private CompanionEntity requireCompanion() {
        CompanionEntity e = companion();
        if (e == null) {
            throw new OpError("no_companion", "还没有伙伴，先 spawn");
        }
        return e;
    }

    private void refreshSnapshot() {
        JsonArray arr = new JsonArray();
        CompanionEntity e = companion();
        if (e != null) {
            JsonObject o = companionJson(e, false);
            o.add("task", current == null ? null : taskJson(current));
            arr.add(o);
        }
        companionsSnapshot = GSON.toJson(arr);
    }

    private JsonObject companionJson(CompanionEntity e, boolean withInventory) {
        JsonObject o = new JsonObject();
        o.addProperty("uuid", e.getUUID().toString());
        o.addProperty("name", e.getName().getString());
        o.addProperty("dim", e.level().dimension().location().toString());
        o.addProperty("x", round(e.getX()));
        o.addProperty("y", round(e.getY()));
        o.addProperty("z", round(e.getZ()));
        o.addProperty("health", round(e.getHealth()));
        o.addProperty("maxHealth", round(e.getMaxHealth()));
        PlayerEngineController c = e.controller();
        o.addProperty("engineReady", c != null);
        if (c != null) {
            Task pe = c.getUserTaskChain().getCurrentTask();
            if (pe != null) {
                o.addProperty("engineTask", pe.toString());
            }
        }
        if (withInventory) {
            JsonArray inv = new JsonArray();
            LivingEntityInventory li = e.getLivingInventory();
            for (int i = 0; i < li.main.size(); i++) {
                addSlot(inv, i, li.main.get(i));
            }
            for (int i = 0; i < li.armor.size(); i++) {
                addSlot(inv, 36 + i, li.armor.get(i));
            }
            addSlot(inv, 40, li.offHand.get(0));
            o.add("inventory", inv);
            o.addProperty("selectedSlot", li.selectedSlot);
        }
        return o;
    }

    private static void addSlot(JsonArray inv, int slot, ItemStack s) {
        if (s.isEmpty()) {
            return;
        }
        JsonObject o = new JsonObject();
        o.addProperty("slot", slot);
        o.addProperty("item", BuiltInRegistries.ITEM.getKey(s.getItem()).toString());
        o.addProperty("count", s.getCount());
        inv.add(o);
    }

    private static JsonObject taskJson(TaskRun t) {
        JsonObject o = new JsonObject();
        o.addProperty("id", t.id);
        o.addProperty("op", t.op);
        o.addProperty("command", t.command);
        if (t.item != null) {
            o.addProperty("item", t.item);
            o.addProperty("want", t.want);
            o.addProperty("before", t.before);
        }
        return o;
    }

    /** 背包里有多少个 item：先当物品 ID（不带命名空间时补 minecraft:），不是物品就当物品标签（log → #minecraft:logs）。 */
    static int countItem(CompanionEntity e, String item) {
        ResourceLocation rl = ResourceLocation.tryParse(item.contains(":") ? item : "minecraft:" + item);
        Optional<Item> it = rl == null ? Optional.empty() : BuiltInRegistries.ITEM.getOptional(rl);
        Predicate<ItemStack> match;
        if (it.isPresent() && it.get() != Items.AIR) {
            Item target = it.get();
            match = s -> s.is(target);
        } else if (rl != null) {
            String path = rl.getPath().endsWith("s") ? rl.getPath() : rl.getPath() + "s";
            TagKey<Item> tag = TagKey.create(Registries.ITEM, new ResourceLocation(rl.getNamespace(), path));
            match = s -> s.is(tag);
        } else {
            return -1;
        }
        LivingEntityInventory li = e.getLivingInventory();
        int n = 0;
        for (ItemStack s : li.main) {
            if (match.test(s)) {
                n += s.getCount();
            }
        }
        for (ItemStack s : li.offHand) {
            if (match.test(s)) {
                n += s.getCount();
            }
        }
        return n;
    }

    // ---- 参数 ----

    private static String str(JsonObject req, String key) {
        JsonElement v = req.get(key);
        if (v == null || !v.isJsonPrimitive()) {
            throw new OpError("bad_args", "缺少参数 " + key);
        }
        return v.getAsString().trim();
    }

    private static int integer(JsonObject req, String key) {
        JsonElement v = req.get(key);
        try {
            return v.getAsInt();
        } catch (RuntimeException e) {
            throw new OpError("bad_args", "参数 " + key + " 要是整数");
        }
    }

    private static int count(JsonObject req, String key) {
        int n = req.has(key) ? integer(req, key) : 1;
        if (n < 1 || n > MAX_COUNT) {
            throw new OpError("bad_args", key + " 要在 1–" + MAX_COUNT + " 之间");
        }
        return n;
    }

    private static String item(JsonObject req) {
        String item = str(req, "item").toLowerCase();
        if (!ITEM.matcher(item).matches()) {
            throw new OpError("bad_args", "物品名只能有小写字母、数字和 _ . - : /：" + item);
        }
        return item;
    }

    private String onlinePlayer(JsonObject req, String key) {
        String name = str(req, key);
        if (!PLAYER.matcher(name).matches()) {
            throw new OpError("bad_args", "玩家名不对：" + name);
        }
        if (server.getPlayerList().getPlayerByName(name) == null) {
            throw new OpError("no_player", "玩家不在线：" + name);
        }
        return name;
    }

    private static double surface(ServerLevel level, double x, double z) {
        return level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, (int) Math.floor(x), (int) Math.floor(z));
    }

    private static JsonObject event(String name) {
        JsonObject o = new JsonObject();
        o.addProperty("event", name);
        return o;
    }

    private static JsonObject error(long id, String code, String message) {
        JsonObject o = new JsonObject();
        o.addProperty("id", id);
        o.addProperty("ok", false);
        o.addProperty("code", code);
        o.addProperty("error", message);
        return o;
    }

    private static double round(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static String fmt(double v) {
        return String.valueOf(round(v));
    }
}
