package minedeck.voicebridge;

import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.VolumeCategory;
import de.maxhenkel.voicechat.api.opus.OpusEncoder;
import de.maxhenkel.voicechat.api.opus.OpusEncoderMode;

import java.io.IOException;
import java.nio.file.Path;
import java.util.UUID;

/**
 * 一次语音服务器生命周期里的全部东西：音量分类、听众、音频引擎、监听端口、配置文件。
 * SVC 的语音服务器停止（或重启）时整个丢掉，下次启动再新建。
 */
final class VoiceBridge {

    static final String CATEGORY_NAME = "MineDeck 音乐共享";
    static final String CATEGORY_DESCRIPTION = "MineDeck 房主共享的音乐。拉到 0 只静音音乐，不影响别人说话。";

    private static final int HOUSEKEEPING_PER_STATS_LOG = 15;

    private final VoicechatServerApi api;
    private final Listeners listeners;
    private final Path configPath;
    private OpusEncoder encoder;
    private AudioEngine engine;
    private ControlServer control;

    // 只在 start() 和引擎线程的 housekeeping 里用
    private volatile BridgeConfig config = BridgeConfig.disabled();
    private long configStamp = -2;
    private boolean warnedMissingConfig;
    private int housekeepingRuns;
    private volatile boolean closed;

    VoiceBridge(VoicechatServerApi api) {
        this.api = api;
        this.listeners = new Listeners(api);
        this.configPath = BridgeConfig.path();
    }

    void start() {
        Log.info("语音服务器已启动，初始化音乐共享（推送方式：" + listeners.modeDescription() + "）");
        registerCategory();
        listeners.open();

        try {
            encoder = api.createEncoder(OpusEncoderMode.AUDIO);
        } catch (Throwable t) {
            Log.error("创建 Opus 编码器失败，音乐共享不可用", t);
            encoder = null;
        }

        loadConfig(true);
        engine = new AudioEngine(encoder, listeners, this::housekeeping);
        control = new ControlServer(engine, listeners);
        applyConfig(config, true);
        engine.start();
    }

    void shutdown(String reason) {
        closed = true;
        if (control != null) {
            control.close(reason);
        }
        if (engine != null) {
            engine.stop(); // 编码器由音频线程退出时关闭
        } else if (encoder != null) {
            try {
                encoder.close();
            } catch (Throwable ignored) {
                // 关不掉也没关系
            }
        }
        listeners.close();
        Log.info("音乐共享已停止（" + reason + "）");
    }

    void playerConnected(VoicechatConnection connection) {
        if (!closed) {
            listeners.connected(connection);
        }
    }

    void playerDisconnected(UUID playerUuid) {
        if (!closed) {
            listeners.disconnected(playerUuid);
        }
    }

    private void registerCategory() {
        try {
            VolumeCategory category = api.volumeCategoryBuilder()
                    .setId(Listeners.CATEGORY_ID)
                    .setName(CATEGORY_NAME)
                    .setDescription(CATEGORY_DESCRIPTION)
                    .setIcon(Icon.musicNote())
                    .build();
            api.registerVolumeCategory(category);
            Log.info("已注册音量分类「" + CATEGORY_NAME + "」（id=" + Listeners.CATEGORY_ID
                    + "）：玩家可以在 SVC 的音量调整界面里单独调小或静音");
        } catch (Throwable t) {
            Log.error("注册音量分类失败（音乐照样能推，只是玩家没法单独调音量）", t);
        }
    }

    /** 引擎线程每 2 秒调用一次。 */
    private void housekeeping() {
        if (closed) {
            return;
        }
        if (loadConfig(false)) {
            applyConfig(config, false);
        }
        control.tick();
        if (++housekeepingRuns % HOUSEKEEPING_PER_STATS_LOG == 0) {
            logStats();
        }
    }

    /** 读配置文件；返回配置是不是变了。first 为真时，文件不存在就生成模板。 */
    private boolean loadConfig(boolean first) {
        long stamp = BridgeConfig.stamp(configPath);
        if (stamp == configStamp) {
            return false;
        }
        if (stamp == -1) {
            if (first) {
                try {
                    BridgeConfig.writeTemplate(configPath);
                    Log.info("没找到配置文件，已生成模板：" + configPath.toAbsolutePath()
                            + "（端口默认关闭；从 MineDeck 开服时会自动写好，手动测试见模组说明）");
                    stamp = BridgeConfig.stamp(configPath);
                } catch (IOException e) {
                    Log.error("生成配置文件失败：" + configPath.toAbsolutePath(), e);
                }
            } else if (!warnedMissingConfig) {
                warnedMissingConfig = true;
                Log.warn("配置文件不见了：" + configPath.toAbsolutePath() + "，继续用之前的设置");
            }
            if (stamp == -1) {
                configStamp = -1;
                return first;
            }
        }
        warnedMissingConfig = false;
        configStamp = stamp;
        try {
            config = BridgeConfig.load(configPath);
            return true;
        } catch (IOException | RuntimeException e) {
            Log.error("读取配置文件失败：" + configPath.toAbsolutePath() + "，继续用之前的设置", e);
            return false;
        }
    }

    private void applyConfig(BridgeConfig c, boolean first) {
        listeners.configure(c);
        boolean selftestBefore = engine.selftest();
        engine.setSelftest(c.selftest);
        control.apply(c);
        if (first) {
            Log.info("配置：" + configPath.toAbsolutePath() + "；端口 " + (c.enabled ? "127.0.0.1:" + c.port : "关闭")
                    + "；排除 " + c.describeExclusions() + "；自测模式 " + (c.selftest ? "开" : "关")
                    + "；隔离群组也能听到 " + (c.bypassGroupIsolation ? "是" : "否")
                    + (listeners.canBypassIsolation ? "" : "（这个版本的 SVC 不支持此设置）"));
        } else {
            Log.info("配置文件已重新读取：端口 " + (c.enabled ? "127.0.0.1:" + c.port : "关闭")
                    + "；排除 " + c.describeExclusions() + "；自测模式 " + (c.selftest ? "开" : "关")
                    + "；当前听众 " + listeners.count() + " 位");
        }
        if (c.selftest && !selftestBefore) {
            Log.info("自测模式已开启：没有广播连接时，会持续给所有装了 SVC 的玩家播放测试音（C 大调琶音）");
        } else if (!c.selftest && selftestBefore) {
            Log.info("自测模式已关闭");
        }
    }

    private void logStats() {
        AudioEngine.Counters w = engine.window;
        long received = w.received.getAndSet(0);
        long played = w.played.getAndSet(0);
        long sent = w.sent.getAndSet(0);
        long bytes = w.bytes.getAndSet(0);
        long dropped = w.dropped.getAndSet(0);
        long underruns = w.underruns.getAndSet(0);
        if (received == 0 && played == 0) {
            return;
        }
        Log.info("最近 30 秒：收到 " + received + " 帧，编码 " + played + " 帧"
                + (played > 0 ? "（平均 " + (bytes / played) + " 字节/帧）" : "")
                + "，发出 " + sent + " 帧，当前听众 " + listeners.count() + " 位"
                + "，丢弃 " + dropped + "，欠载 " + underruns
                + (control.hasBroadcast() ? "" : "，当前没有广播连接")
                + (engine.selftest() ? "，自测模式开" : ""));
    }
}
