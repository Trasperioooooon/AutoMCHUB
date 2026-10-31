package minedeck.companion.client;

import minedeck.companion.CompanionMod;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

/** 客户端才加载：给伙伴实体注册渲染器。专用服务器上 FML 不会加载这个类。 */
@EventBusSubscriber(modid = CompanionMod.MODID, bus = EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public final class ClientSetup {

    private ClientSetup() {
    }

    @SubscribeEvent
    public static void onRegisterRenderers(EntityRenderersEvent.RegisterRenderers event) {
        event.registerEntityRenderer(CompanionMod.COMPANION.get(), CompanionRenderer::new);
    }
}
