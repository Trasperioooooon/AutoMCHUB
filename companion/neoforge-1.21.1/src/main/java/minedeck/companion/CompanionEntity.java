package minedeck.companion;

import java.util.List;

import com.player2.playerengine.PlayerEngineController;
import com.player2.playerengine.automaton.api.IBaritone;
import com.player2.playerengine.automaton.api.entity.IAutomatone;
import com.player2.playerengine.automaton.api.entity.IHungerManagerProvider;
import com.player2.playerengine.automaton.api.entity.IInteractionManagerProvider;
import com.player2.playerengine.automaton.api.entity.IInventoryProvider;
import com.player2.playerengine.automaton.api.entity.LivingEntityHungerManager;
import com.player2.playerengine.automaton.api.entity.LivingEntityInteractionManager;
import com.player2.playerengine.automaton.api.entity.LivingEntityInventory;
import com.player2.playerengine.player2api.Character;
import com.player2.playerengine.player2api.manager.ConversationManager;
import com.player2.playerengine.util.ChunkController;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;

/**
 * 伙伴实体：一个"像玩家一样"的 LivingEntity（不是 ServerPlayer，所以不占玩家位、不在 Tab 列表里）。
 *
 * <p>PlayerEngine 把"玩家的能力"做成接口：实现 {@link IAutomatone}（拿到内嵌的 Automatone/Baritone）、
 * {@link IInventoryProvider}（玩家式背包）、{@link IInteractionManagerProvider}（挖方块、用物品）、
 * {@link IHungerManagerProvider}（饥饿，PlayerEngine 1.4 默认关闭）。这个类只负责把这些能力接到实体上：
 * 每个 tick 推进挖掘进度、背包物品、PlayerEngine 的任务和寻路；手上和身上的装备直接读写背包；捡起附近的掉落物。
 * PlayerEngine 通过 xxa / zza / jumping 驱动移动，LivingEntity 自己的 aiStep → travel 让它真正走起来。
 */
public class CompanionEntity extends LivingEntity
        implements IAutomatone, IInventoryProvider, IInteractionManagerProvider, IHungerManagerProvider {

    /** 交给 PlayerEngine 的"游戏 ID"：PlayerEngine 只拿它去 Player2 换令牌，我们从不让它走到那一步。 */
    static final String CLIENT_ID = "minedeck-companion";
    /**
     * PlayerEngine 前进时把 zza 设成 0.3（玩家按住 W 是 0.98），速度属性按比例放大到 0.33，
     * 实际走路速度和玩家差不多（推断：没有逐 tick 对比过）。
     */
    static final double WALK_SPEED = 0.33;

    private final LivingEntityInventory inventory = new LivingEntityInventory(this);
    private final LivingEntityInteractionManager interactionManager = new LivingEntityInteractionManager(this);
    private final LivingEntityHungerManager hungerManager = new LivingEntityHungerManager();
    private PlayerEngineController controller;
    private boolean controllerFailed;
    private boolean adopted;
    private long lastTickError;

    public CompanionEntity(EntityType<? extends CompanionEntity> type, Level level) {
        super(type, level);
    }

    public static AttributeSupplier.Builder createAttributes() {
        // 用玩家的整套属性（攻击、挖掘速度、交互距离……），只改移动速度
        return Player.createAttributes().add(Attributes.MOVEMENT_SPEED, WALK_SPEED);
    }

    /** 服务端才有；第一次 tick 时创建。 */
    public PlayerEngineController controller() {
        return controller;
    }

    @Override
    public LivingEntityInventory getLivingInventory() {
        return inventory;
    }

    @Override
    public LivingEntityInteractionManager getInteractionManager() {
        return interactionManager;
    }

    @Override
    public LivingEntityHungerManager getHungerManager() {
        return hungerManager;
    }

    @Override
    public void tick() {
        if (!level().isClientSide) {
            serverPreTick();
        }
        super.tick();
    }

    private void serverPreTick() {
        if (!adopted) {
            adopted = true;
            CompanionManager.adopt(this);
        }
        if (controller == null && !controllerFailed) {
            try {
                controller = createController();
                CompanionMod.LOG.info("伙伴 {} 的 PlayerEngine 控制器已创建（不登录 Player2，对话层已关闭）", getName().getString());
            } catch (Throwable t) {
                controllerFailed = true;
                CompanionMod.LOG.error("创建 PlayerEngine 控制器失败，伙伴不会动", t);
            }
        }
        interactionManager.update();
        inventory.updateItems();
        if (controller != null) {
            try {
                controller.serverTick();
            } catch (Throwable t) {
                long now = System.currentTimeMillis();
                if (now - lastTickError > 5000) {
                    lastTickError = now;
                    CompanionMod.LOG.error("PlayerEngine 的 tick 出错（5 秒内只记一次）", t);
                }
            }
        }
        setYHeadRot(getYRot());
    }

    private PlayerEngineController createController() {
        String name = getName().getString();
        Character character = new Character(CLIENT_ID, name, name, "", "MineDeck companion", "", new String[0]);
        // owner 传 null：PlayerEngine 的对话层（ConversationManager.process）只处理有主人的伙伴，
        // 心跳也只在主人有 Player2 令牌时才发。再把这个伙伴的对话队列关掉，双保险。
        PlayerEngineController c = new PlayerEngineController(IBaritone.KEY.get(this), character, CLIENT_ID, null);
        ConversationManager.getOrCreateEventQueueData(c).setEnabled(false);
        // 任何玩家（不用 OP）都能打 /playerengine relog：它会对这张表里每个伙伴发起 Player2 登录（连 api.player2.game）。
        // 我们的伙伴从表里拿掉，这条命令就碰不到它（表只给 PlayerEngine 自己的管理命令用）
        PlayerEngineController.staticAPIServices.remove(getUUID());
        return c;
    }

    @Override
    public void aiStep() {
        if (!level().isClientSide) {
            // 玩家每 tick 按速度属性设一次速度；PlayerEngine 只在寻路时设（它的 mixin），平时也要有
            setSpeed((float) getAttributeValue(Attributes.MOVEMENT_SPEED));
        }
        super.aiStep();
        updateSwingTime();
        if (!level().isClientSide && isAlive()) {
            pickUpItems();
        }
    }

    /** 像玩家一样捡起碰到的掉落物，放进背包（PlayerEngine 自己不做这件事）。 */
    private void pickUpItems() {
        List<ItemEntity> items = level().getEntitiesOfClass(ItemEntity.class, getBoundingBox().inflate(1.0, 0.5, 1.0));
        for (ItemEntity item : items) {
            if (item.isRemoved() || item.hasPickUpDelay()) {
                continue;
            }
            ItemStack stack = item.getItem();
            int before = stack.getCount();
            ItemStack rest = stack.copy();
            if (!inventory.insertStack(rest)) {
                continue;
            }
            int taken = before - rest.getCount();
            if (taken <= 0) {
                continue;
            }
            take(item, taken);
            if (rest.isEmpty()) {
                item.discard();
            } else {
                item.setItem(rest);
            }
        }
    }

    // ---- 装备直接读写背包（和原版 Player 一样），PlayerEngine 选工具时只改 selectedSlot ----

    @Override
    public Iterable<ItemStack> getArmorSlots() {
        return inventory.armor;
    }

    @Override
    public Iterable<ItemStack> getHandSlots() {
        return List.of(getMainHandItem(), getOffhandItem());
    }

    @Override
    public ItemStack getItemBySlot(EquipmentSlot slot) {
        switch (slot.getType()) {
            case HAND:
                return slot == EquipmentSlot.MAINHAND ? inventory.getMainHandStack() : inventory.offHand.get(0);
            case HUMANOID_ARMOR:
                return inventory.armor.get(slot.getIndex());
            default:
                return ItemStack.EMPTY;
        }
    }

    @Override
    public void setItemSlot(EquipmentSlot slot, ItemStack stack) {
        verifyEquippedItem(stack);
        ItemStack old;
        switch (slot.getType()) {
            case HAND:
                if (slot == EquipmentSlot.MAINHAND) {
                    int sel = inventory.selectedSlot;
                    if (!LivingEntityInventory.isValidHotbarIndex(sel)) {
                        return;
                    }
                    old = inventory.main.set(sel, stack);
                } else {
                    old = inventory.offHand.set(0, stack);
                }
                break;
            case HUMANOID_ARMOR:
                old = inventory.armor.set(slot.getIndex(), stack);
                break;
            default:
                return;
        }
        onEquipItem(slot, old, stack);
    }

    @Override
    public HumanoidArm getMainArm() {
        return HumanoidArm.RIGHT;
    }

    // ---- 存档 ----

    @Override
    public void addAdditionalSaveData(CompoundTag tag) {
        super.addAdditionalSaveData(tag);
        tag.put("Inventory", inventory.writeNbt(registryAccess(), new ListTag()));
        tag.putInt("SelectedItemSlot", inventory.selectedSlot);
    }

    @Override
    public void readAdditionalSaveData(CompoundTag tag) {
        super.readAdditionalSaveData(tag);
        inventory.readNbt(registryAccess(), tag.getList("Inventory", Tag.TAG_COMPOUND));
        inventory.selectedSlot = tag.getInt("SelectedItemSlot");
    }

    // ---- 死亡和移除 ----

    @Override
    protected void dropEquipment() {
        inventory.dropAll();
    }

    @Override
    public void die(DamageSource source) {
        super.die(source);
        if (!level().isClientSide) {
            CompanionManager.onDied(this, source);
        }
    }

    @Override
    public void remove(RemovalReason reason) {
        if (!level().isClientSide && reason.shouldDestroy()) {
            releaseEngine();
            CompanionManager.onRemoved(this, reason);
        }
        super.remove(reason);
    }

    /** 停掉 PlayerEngine 的任务，从它的全局表里删掉，并放开它替伙伴强制加载的区块。 */
    private void releaseEngine() {
        if (controller != null) {
            try {
                controller.stop();
            } catch (Throwable t) {
                CompanionMod.LOG.warn("停止 PlayerEngine 控制器时出错：{}", t.toString());
            }
        }
        PlayerEngineController.unregisterFromGlobalRegistry(getUUID());
        ConversationManager.despwnCompanion(getUUID());
        // PlayerEngine 的 ChunkLoadingTracker 用 setChunkForced 强制加载伙伴脚下的 4 个区块，
        // 伙伴没了它也不放开（强制加载会存进存档），这里替它放开
        if (level() instanceof ServerLevel sl) {
            ChunkPos c = chunkPosition();
            for (int dx = -1; dx <= 1; dx++) {
                for (int dz = -1; dz <= 1; dz++) {
                    for (int k = 0; k < 4; k++) {
                        ChunkController.instance.unload(sl, getUUID(), c.x + dx, c.z + dz);
                    }
                }
            }
        }
    }
}
