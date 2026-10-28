// Package secret 用 Windows DPAPI 加密存放密钥：CurseForge API Key、穿透凭据，以后还有 AI 的 Key。
//
// 密文绑定当前 Windows 用户的登录凭据，换一台电脑或换一个 Windows 用户就解不开。MineDeck 是便携软件，
// 整个文件夹拷到别的电脑后要重填密钥，这是有意的。它防的是 config.json、tunnels.json 被拷走、
// 同步到网盘或发给别人时把密钥一起带出去；挡不住同一个 Windows 用户下运行的恶意程序。
package secret

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
)

const prefix = "dpapi:"

// ErrUnreadable 密文解不开：多半是换了电脑或 Windows 用户。调用方按「没设置」处理，并提示用户重填。
var ErrUnreadable = errors.New("密钥无法解开，可能换了电脑或 Windows 用户，请重新填写")

// IsSealed 是否已是加密后的写法（"dpapi:" 开头）。
func IsSealed(s string) bool { return strings.HasPrefix(s, prefix) }

// Seal 加密明文，返回 "dpapi:BASE64"；空串原样返回。
func Seal(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	b := []byte(plain)
	defer clear(b)
	out, err := protect(b)
	if err != nil {
		return "", fmt.Errorf("加密失败: %w", err)
	}
	return prefix + base64.StdEncoding.EncodeToString(out), nil
}

// Unseal 解开 Seal 的结果。不是 "dpapi:" 开头的按明文原样返回（迁移前的旧数据）；解不开返回 ErrUnreadable。
// 系统交回的明文缓冲区用完即清零；返回的 string 没法清零，调用方用完尽快丢掉。
func Unseal(s string) (string, error) {
	if !IsSealed(s) {
		return s, nil
	}
	blob, err := base64.StdEncoding.DecodeString(s[len(prefix):])
	if err != nil {
		return "", ErrUnreadable
	}
	b, err := unprotect(blob)
	if err != nil {
		return "", fmt.Errorf("%w（%v）", ErrUnreadable, err)
	}
	defer clear(b)
	return string(b), nil
}

// Store 一个 JSON 文件里的一组密钥，形如 {"cf.key": "dpapi:…"}，文件权限 0600。
// 每次读写都直接读写文件，内存里不留明文，也不缓存密文。
type Store struct{ path string }

// fileMu 串行化所有 Store 的读-改-写（同一文件可能有多个 Store 值）。
var fileMu sync.Mutex

func NewStore(path string) *Store { return &Store{path: path} }

func (s *Store) load() (map[string]string, error) {
	m := map[string]string{}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return m, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("%s 格式不对: %w", s.path, err)
	}
	return m, nil
}

// Get 取出并解密一项；没有这一项返回空串；解不开返回 ErrUnreadable。
func (s *Store) Get(name string) (string, error) {
	fileMu.Lock()
	m, err := s.load()
	fileMu.Unlock()
	if err != nil {
		return "", err
	}
	if m[name] == "" {
		return "", nil
	}
	return Unseal(m[name])
}

// State 不交出明文，只说这一项是否已设置、能否解开。
func (s *Store) State(name string) (set, unreadable bool) {
	v, err := s.Get(name)
	if err != nil {
		return false, true
	}
	return v != "", false
}

// Set 加密后存入一项；plain 为空串时删除这一项。先写临时文件再改名，写到一半断电也不会留下半个文件。
func (s *Store) Set(name, plain string) error {
	var sealed string
	if plain != "" {
		var err error
		if sealed, err = Seal(plain); err != nil {
			return err
		}
	}
	fileMu.Lock()
	defer fileMu.Unlock()
	m, err := s.load()
	if err != nil {
		return err
	}
	if sealed == "" {
		if _, ok := m[name]; !ok {
			return nil
		}
		delete(m, name)
	} else {
		m[name] = sealed
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
