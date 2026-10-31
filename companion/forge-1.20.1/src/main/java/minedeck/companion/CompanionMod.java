package minedeck.companion;

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.EntityAttributeCreationEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.ModLoadingContext;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * MineDeck 伙伴模组（原型）Forge 1.20.1 版入口，做法和 NeoForge 1.21.1 版一样：注册伙伴实体，开服后打开本机控制端口。
 * 不登录 Player2、不调用 Player2 的网页接口（伙伴没有主人，PlayerEngine 的对话层不处理它）。
 */
@Mod(CompanionMod.MODID)
public final class CompanionMod {

    public static final String MODID = "minedeck_companion";
    public static final Logger LOG = LoggerFactory.getLogger(MODID);

    public static final DeferredRegister<EntityType<?>> ENTITIES = DeferredRegister.create(ForgeRegistries.ENTITY_TYPES, MODID);
    public static final RegistryObject<EntityType<CompanionEntity>> COMPANION = ENTITIES.register("companion",
            () -> EntityType.Builder.<CompanionEntity>of(CompanionEntity::new, MobCategory.MISC)
                    .sized(0.6F, 1.8F)
                    .clientTrackingRange(10)
                    .updateInterval(2)
                    .build(MODID + ":companion"));

    static String version = "0.0.0";

    public CompanionMod() {
        IEventBus modBus = FMLJavaModLoadingContext.get().getModEventBus();
        version = ModLoadingContext.get().getActiveContainer().getModInfo().getVersion().toString();
        ENTITIES.register(modBus);
        modBus.addListener(CompanionMod::onAttributes);
        MinecraftForge.EVENT_BUS.addListener(CompanionMod::onServerStarted);
        MinecraftForge.EVENT_BUS.addListener(CompanionMod::onServerStopping);
        MinecraftForge.EVENT_BUS.addListener(CompanionMod::onServerTick);
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

    private static void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase == TickEvent.Phase.END) {
            CompanionManager.tick();
        }
    }
}
