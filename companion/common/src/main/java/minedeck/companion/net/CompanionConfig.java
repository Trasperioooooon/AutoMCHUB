package minedeck.companion.net;

import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.SecureRandom;
import java.util.Properties;

/**
 * config/minedeck/companion.properties（相对服务端的工作目录，和音乐桥接的 voicebridge.properties 同一层）。
 *
 * <p>文件不存在时生成一份端口关闭的模板（令牌随机）。MineDeck 开服前写好 enabled=true、端口和令牌；
 * 原型只在开服时读一次，改了要重启服务器（正式版照音乐桥接的做法每 2 秒热重读）。
 */
public final class CompanionConfig {

    public static final String RELATIVE_PATH = "config/minedeck/companion.properties";
    public static final int DEFAULT_PORT = 24480;
    public static final int MIN_TOKEN_LENGTH = 16;

    public final boolean enabled;
    public final int port;
    public final String token;
    /** 配置写错时的原因（这时不开端口）；没问题时为 null。 */
    public final String problem;
    public final Path path;

    private CompanionConfig(Path path, boolean enabled, int port, String token, String problem) {
        this.path = path;
        this.enabled = enabled;
        this.port = port;
        this.token = token;
        this.problem = problem;
    }

    public static CompanionConfig load(Path gameDir) throws IOException {
        Path path = gameDir.resolve(RELATIVE_PATH).toAbsolutePath().normalize();
        if (!Files.exists(path)) {
            writeTemplate(path);
        }
        Properties p = new Properties();
        try (InputStream in = Files.newInputStream(path);
                Reader r = new java.io.InputStreamReader(in, StandardCharsets.UTF_8)) {
            p.load(r);
        }
        boolean enabled = Boolean.parseBoolean(p.getProperty("enabled", "false").trim());
        String token = p.getProperty("token", "").trim();
        String problem = null;
        int port = DEFAULT_PORT;
        String ps = p.getProperty("port", "").trim();
        if (!ps.isEmpty()) {
            try {
                port = Integer.parseInt(ps);
            } catch (NumberFormatException e) {
                problem = "port 不是数字：" + ps;
            }
        }
        if (problem == null && (port < 1024 || port > 65535)) {
            problem = "port 要在 1024–65535 之间：" + port;
        }
        if (problem == null && token.length() < MIN_TOKEN_LENGTH) {
            problem = "token 至少 " + MIN_TOKEN_LENGTH + " 个字符";
        }
        return new CompanionConfig(path, enabled, port, token, problem);
    }

    private static void writeTemplate(Path path) throws IOException {
        Files.createDirectories(path.getParent());
        byte[] raw = new byte[16];
        new SecureRandom().nextBytes(raw);
        StringBuilder token = new StringBuilder();
        for (byte b : raw) {
            token.append(String.format("%02x", b & 0xFF));
        }
        Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
        try (Writer w = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
            w.write("# MineDeck 伙伴模组的本机控制端口（只监听 127.0.0.1）。由 MineDeck 写入，一般不用手改。\n");
            w.write("enabled=false\n");
            w.write("port=" + DEFAULT_PORT + "\n");
            w.write("token=" + token + "\n");
        }
        Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
}
