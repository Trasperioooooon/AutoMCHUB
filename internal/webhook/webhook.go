// Package webhook 把事件总线上的事件以 JSON POST 推送到用户配置的 URL（失败重试 3 次）。
package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"

	"automchub/internal/app"
	"automchub/internal/dl"
	"automchub/internal/events"
)

// Init 订阅事件总线（URL 实时读取配置，改配置即时生效）。
func Init() {
	events.Subscribe(func(e events.Event) {
		url := app.GetConfig().WebhookURL
		if url == "" {
			return
		}
		body, err := json.Marshal(e)
		if err != nil {
			return
		}
		for attempt := 0; attempt < 3; attempt++ {
			if attempt > 0 {
				time.Sleep(time.Duration(attempt*3) * time.Second)
			}
			if post(url, body) {
				return
			}
		}
	})
}

func post(url string, body []byte) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", dl.UA)
	resp, err := dl.Client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}
