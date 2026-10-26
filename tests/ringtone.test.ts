import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"

import {
  BUILTIN_RINGTONES,
  loadRingtoneConfig,
  saveRingtoneConfig,
} from "../src/lib/ringtone.ts"

describe("Ringtone Config & Persistence (Cài Đặt Nhạc Chuông Cục Bộ)", () => {
  beforeEach(() => {
    // Mock localStorage trong môi trường Node.js
    const store = new Map<string, string>()
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      length: store.size,
    } as unknown as Storage
  })

  it("mặc định khi chưa cài đặt là giai điệu marimba, volume 0.85", () => {
    const cfg = loadRingtoneConfig()
    assert.equal(cfg.id, "marimba")
    assert.equal(cfg.volume, 0.85)
    assert.equal(cfg.customDataUrl, undefined)
  })

  it("lưu và nạp lại giai điệu có sẵn thành công", () => {
    saveRingtoneConfig({ id: "bell", volume: 0.7 })
    const cfg = loadRingtoneConfig()
    assert.equal(cfg.id, "bell")
    assert.equal(cfg.volume, 0.7)
  })

  it("lưu và nạp lại nhạc chuông tùy chỉnh tải lên từ máy", () => {
    const mockAudioData = "data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAA..."
    saveRingtoneConfig({
      id: "custom",
      customDataUrl: mockAudioData,
      customName: "bai_hat_yeu_thich.mp3",
      volume: 1.0,
    })

    const cfg = loadRingtoneConfig()
    assert.equal(cfg.id, "custom")
    assert.equal(cfg.customName, "bai_hat_yeu_thich.mp3")
    assert.equal(cfg.customDataUrl, mockAudioData)
    assert.equal(cfg.volume, 1.0)
  })

  it("danh sách nhạc chuông mặc định chứa đầy đủ 5 lựa chọn", () => {
    assert.equal(BUILTIN_RINGTONES.length, 5)
    const ids = BUILTIN_RINGTONES.map((r) => r.id)
    assert.ok(ids.includes("marimba"))
    assert.ok(ids.includes("chimes"))
    assert.ok(ids.includes("bell"))
    assert.ok(ids.includes("gentle"))
    assert.ok(ids.includes("custom"))
  })
})
