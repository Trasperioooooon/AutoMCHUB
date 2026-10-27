package autostart

import (
	"errors"
	"fmt"
	"os"
	"testing"

	"golang.org/x/sys/windows/registry"
)

// 在临时键上测，不碰真实的 Run 键：只删旧值、不动新值；键或值本就不存在时不报错（每次启动都会调用）。
func TestDeleteValue(t *testing.T) {
	path := fmt.Sprintf(`Software\MineDeck-autostart-test-%d`, os.Getpid())
	k, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		k.Close()
		_ = registry.DeleteKey(registry.CURRENT_USER, path)
	})
	for _, name := range []string{legacyValueName, valueName} {
		if err := k.SetStringValue(name, `"C:\MC\MineDeck.exe" -minimized`); err != nil {
			t.Fatal(err)
		}
	}

	if err := deleteValue(path, legacyValueName); err != nil {
		t.Fatalf("删除旧值失败: %v", err)
	}
	if _, _, err := k.GetStringValue(legacyValueName); !errors.Is(err, registry.ErrNotExist) {
		t.Errorf("旧值 %s 应已删除，读取结果 err = %v", legacyValueName, err)
	}
	if _, _, err := k.GetStringValue(valueName); err != nil {
		t.Errorf("新值 %s 不应受影响: %v", valueName, err)
	}

	if err := deleteValue(path, legacyValueName); err != nil {
		t.Errorf("值已不存在时应视为成功: %v", err)
	}
	if err := deleteValue(path+`\missing`, legacyValueName); err != nil {
		t.Errorf("键不存在时应视为成功: %v", err)
	}
}
