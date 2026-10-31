package minedeck.companion;

import net.minecraft.core.registries.Registries;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * MineDeck 伙伴模组（原型）入口：注册伙伴实体，开服后打开本机控制端口。
 *
 * <p>伙伴的"身体"是 PlayerEngine：寻路（内嵌的 Automatone / Baritone）、任务（采集、跟随、给东西……）、背包。
 * 这个模组不登录 Player2、不调用 Player2 的网页接口：伙伴没有"主人"（owner 为空），PlayerEngine 的对话层
 * 只处理有主人的伙伴，所以它听不到聊天、也不会去调大模型；指令全部来自 MineDeck 的本机连接。
 */
@Mod(CompanionMod.MODID)
public final class CompanionMod {

    public static final String MODID = "minedeck_companion";
    public static final Logger LOG = LoggerFactory.getLogger(MODID);

    public static final DeferredRegister<EntityType<?>> ENTITIES = DeferredRegister.create(Registries.ENTITY_TYPE, MODID);
    public static final DeferredHolder<EntityType<?>, EntityType<CompanionEntity>> COMPANION = ENTITIES.register("companion",
            () -> EntityType.Builder.<CompanionEntity>of(CompanionEntity::new, MobCategory.MISC)
                    .sized(0.6F, 1.8F)
                    .eyeHeight(1.62F)
                    .clientTrackingRange(10)
                    .updateInterval(2)
                    .build(MODID + ":companion"));

    static String version = "0.0.0";

    public CompanionMod(IEventBus modBus, ModContainer container) {
        version = container.getModInfo().getVersion().toString();
        ENTITIES.register(modBus);
        modBus.addListener(CompanionMod::onAttributes);
        NeoForge.EVENT_BUS.addListener(CompanionMod::onServerStarted);
        NeoForge.EVENT_BUS.addListener(CompanionMod::onServerStopping);
        NeoForge.EVENT_BUS.addListener(CompanionMod::onServerTick);
        LOG.info("MineDeck 伙伴模组 {} 已加载", version);
    }

    private static void onAttributes(EntityAttributeCreationEvent event) {
        event.put(COMPANION.get(), CompanionEntity.createAttributes().build());
    }

    private static void onServerStarted(ServerStartedEvent event) {
        CompanionManager.start(event.getServer(), version);
    }

    private static void onServerStopping(ServerStoppingEvent event) {
        CompanionManager.stop();
    }

    private static void onServerTick(ServerTickEvent.Post event) {
        CompanionManager.tick();
    }
}
