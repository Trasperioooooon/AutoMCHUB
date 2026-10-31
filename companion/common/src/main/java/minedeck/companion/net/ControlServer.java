package minedeck.companion.net;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.slf4j.Logger;

/**
 * 在 127.0.0.1 上监听 MineDeck（或 testctl）的控制连接。同一时间只接受一个控制连接。
 *
 * <p>网络线程只负责收发和握手：收到的指令交给 {@link Handler}，由它切到服务器主线程去执行；
 * 发给对方的帧都放进这个连接自己的发送队列，由发送线程去写，别的线程（主线程、状态线程）从不卡在 socket 上。
 */
public final class ControlServer {

    public interface Handler {
        /** 网络线程上调用。实现要切到服务器主线程执行，并且每条指令都要回一条 RESPONSE。 */
        void onRequest(String json, Connection conn);

        /** WELCOME 里的 JSON。网络线程上调用，要线程安全（读快照）。 */
        String welcomeJson();

        /** 每 2 秒一次的 STATUS。状态线程上调用，要线程安全（读快照）。 */
        String statusJson();
    }

    static final int HANDSHAKE_TIMEOUT_MS = 5000;
    /** 10 秒没收到任何帧就认为对方掉线（MineDeck 每 2 秒发一次 PING）。 */
    static final int IDLE_TIMEOUT_MS = 10000;
    static final int OUTBOX_FRAMES = 256;
    static final long STATUS_INTERVAL_MS = 2000L;

    private final Handler handler;
    private final Logger log;
    private final AtomicReference<Connection> active = new AtomicReference<>();
    private volatile ServerSocket socket;
    private volatile String token = "";
    private volatile boolean closed;
    private Thread statusThread;

    public ControlServer(Handler handler, Logger log) {
        this.handler = handler;
        this.log = log;
    }

    public synchronized void start(CompanionConfig config) throws IOException {
        token = config.token;
        ServerSocket s = new ServerSocket();
        try {
            s.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), config.port), 4);
        } catch (IOException e) {
            s.close();
            throw e;
        }
        socket = s;
        Thread accept = new Thread(this::acceptLoop, "MineDeck-Companion-Accept");
        accept.setDaemon(true);
        accept.start();
        statusThread = new Thread(this::statusLoop, "MineDeck-Companion-Status");
        statusThread.setDaemon(true);
        statusThread.start();
        log.info("伙伴控制端口已打开：127.0.0.1:{}（只接受本机连接，同一时间只接受一个控制连接）", config.port);
    }

    public synchronized void close(String reason) {
        closed = true;
        ServerSocket s = socket;
        socket = null;
        if (s != null) {
            try {
                s.close();
            } catch (IOException ignored) {
                // 已经关了
            }
        }
        if (statusThread != null) {
            statusThread.interrupt();
        }
        Connection c = active.get();
        if (c != null) {
            c.end(reason);
        }
    }

    /** 给当前的控制连接发一个事件；没有连接时丢掉（MineDeck 重连后用 status 拿最新状态）。 */
    public void event(String json) {
        Connection c = active.get();
        if (c != null) {
            c.send(Protocol.EVENT, Protocol.utf8(json));
        }
    }

    public boolean connected() {
        return active.get() != null;
    }

    private void acceptLoop() {
        ServerSocket s = socket;
        while (s != null && !s.isClosed()) {
            Socket sock;
            try {
                sock = s.accept();
            } catch (IOException e) {
                if (!s.isClosed()) {
                    log.error("接受连接时出错", e);
                }
                return;
            }
            Thread t = new Thread(() -> serve(sock), "MineDeck-Companion-Conn");
            t.setDaemon(true);
            t.start();
        }
    }

    private void statusLoop() {
        while (!closed) {
            try {
                Thread.sleep(STATUS_INTERVAL_MS);
            } catch (InterruptedException e) {
                return;
            }
            Connection c = active.get();
            if (c != null) {
                try {
                    c.send(Protocol.STATUS, Protocol.utf8(handler.statusJson()));
                } catch (RuntimeException e) {
                    log.warn("生成 STATUS 失败：{}", e.toString());
                }
            }
        }
    }

    private void serve(Socket sock) {
        Connection conn = null;
        try {
            sock.setTcpNoDelay(true);
            sock.setSoTimeout(HANDSHAKE_TIMEOUT_MS);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            Protocol.Frame hello = Protocol.read(in);
            if (hello == null) {
                return;
            }
            if (hello.type != Protocol.HELLO || hello.payload.length < 3) {
                reject(out, Protocol.E_PROTOCOL, "第一帧必须是 HELLO");
                return;
            }
            int version = Protocol.u16(hello.payload, 0);
            if (version != Protocol.VERSION) {
                reject(out, Protocol.E_VERSION, "不支持协议版本 " + version + "，模组是第 " + Protocol.VERSION + " 版");
                return;
            }
            int tokenLen = hello.payload[2] & 0xFF;
            if (3 + tokenLen > hello.payload.length) {
                reject(out, Protocol.E_PROTOCOL, "HELLO 的令牌长度不对");
                return;
            }
            byte[] got = new byte[tokenLen];
            System.arraycopy(hello.payload, 3, got, 0, tokenLen);
            if (!MessageDigest.isEqual(got, token.getBytes(StandardCharsets.UTF_8))) {
                reject(out, Protocol.E_BAD_TOKEN, "令牌不对");
                return;
            }
            String client = new String(hello.payload, 3 + tokenLen, hello.payload.length - 3 - tokenLen,
                    StandardCharsets.UTF_8);
            conn = new Connection(sock, out, client);
            if (!active.compareAndSet(null, conn)) {
                reject(out, Protocol.E_BUSY, "已经有一个控制连接");
                return;
            }
            conn.startWriter();
            conn.send(Protocol.WELCOME, Protocol.versionAnd(handler.welcomeJson()));
            log.info("控制连接已建立（{}，{}）", client.isEmpty() ? "未署名" : client, sock.getRemoteSocketAddress());
            sock.setSoTimeout(IDLE_TIMEOUT_MS);
            while (!conn.closed) {
                Protocol.Frame f;
                try {
                    f = Protocol.read(in);
                } catch (SocketTimeoutException e) {
                    log.warn("控制连接 {} 秒没有消息，断开", IDLE_TIMEOUT_MS / 1000);
                    conn.end("心跳超时");
                    break;
                }
                if (f == null) {
                    break;
                }
                switch (f.type) {
                    case Protocol.PING:
                        conn.send(Protocol.PONG, f.payload);
                        break;
                    case Protocol.REQUEST:
                        handler.onRequest(f.text(), conn);
                        break;
                    case Protocol.END:
                        log.info("MineDeck 结束了控制连接：{}", f.text());
                        conn.closed = true;
                        break;
                    default:
                        conn.send(Protocol.ERROR, Protocol.error(Protocol.E_PROTOCOL, "不认识的帧类型 " + f.type));
                        conn.end("协议错误");
                        break;
                }
            }
        } catch (Protocol.ProtocolException e) {
            log.warn("控制连接协议错误：{}", e.getMessage());
        } catch (IOException e) {
            if (conn == null || !conn.closed) {
                log.info("控制连接断开：{}", e.toString());
            }
        } finally {
            if (conn != null) {
                // 先让出"当前连接"的位置，MineDeck 马上重连时不会被当成"已经有一个控制连接"
                if (active.compareAndSet(conn, null)) {
                    log.info("控制连接已关闭");
                }
                conn.finish();
            } else {
                closeQuietly(sock);
            }
        }
    }

    private void reject(OutputStream out, int code, String message) {
        log.warn("拒绝控制连接：{}", message);
        try {
            Protocol.write(out, Protocol.ERROR, Protocol.error(code, message));
        } catch (IOException ignored) {
            // 对方已经断开
        }
    }

    static void closeQuietly(Socket s) {
        try {
            s.close();
        } catch (IOException ignored) {
            // 已经关了
        }
    }

    /** 一个控制连接。{@link #send} 只往发送队列里放，由发送线程去写。 */
    public final class Connection {
        private final Socket sock;
        private final OutputStream out;
        private final String client;
        private final BlockingQueue<Protocol.Frame> outbox = new ArrayBlockingQueue<>(OUTBOX_FRAMES);
        volatile boolean closed;

        Connection(Socket sock, OutputStream out, String client) {
            this.sock = sock;
            this.out = out;
            this.client = client;
        }

        public String client() {
            return client;
        }

        public void response(String json) {
            send(Protocol.RESPONSE, Protocol.utf8(json));
        }

        private Thread writer;

        void startWriter() {
            writer = new Thread(this::writeLoop, "MineDeck-Companion-Send");
            writer.setDaemon(true);
            writer.start();
        }

        /** 读线程退出时调用：最多等 0.5 秒把队列里剩下的帧（比如 END）发出去，再关 socket。 */
        void finish() {
            closed = true;
            if (writer != null && writer != Thread.currentThread()) {
                try {
                    writer.join(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            shutdown();
        }

        void send(int type, byte[] payload) {
            if (closed) {
                return;
            }
            if (payload.length > Protocol.MAX_PAYLOAD) {
                log.warn("要发的帧太长（{} 字节），丢掉", payload.length);
                return;
            }
            if (!outbox.offer(new Protocol.Frame(type, payload))) {
                log.warn("发送队列满了（对方不读数据？），断开控制连接");
                shutdown();
            }
        }

        void end(String reason) {
            send(Protocol.END, Protocol.utf8(reason == null ? "" : reason));
            closed = true;
        }

        private void writeLoop() {
            try {
                while (true) {
                    Protocol.Frame f = outbox.poll(100, TimeUnit.MILLISECONDS);
                    if (f == null) {
                        if (closed) {
                            break;
                        }
                        continue;
                    }
                    Protocol.write(out, f.type, f.payload);
                    if (f.type == Protocol.END || f.type == Protocol.ERROR) {
                        break;
                    }
                }
            } catch (InterruptedException | IOException e) {
                // 连接断了
            } finally {
                shutdown();
            }
        }

        void shutdown() {
            closed = true;
            closeQuietly(sock);
        }
    }
}
