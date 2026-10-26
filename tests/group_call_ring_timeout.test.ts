import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { shouldTimeoutUnansweredGroupMember } from "../src/lib/callGuard.ts"

describe("shouldTimeoutUnansweredGroupMember - tự ngắt chuông sau 30 giây khi không nghe máy trong cuộc gọi nhóm", () => {
  it("cuộc gọi nhóm đến, đang đổ chuông, đã qua 30 giây → TỰ NGẮT (true)", () => {
    const dialedAt = 1_000_000
    const now = dialedAt + 30_000 // đúng 30s

    assert.equal(
      shouldTimeoutUnansweredGroupMember({
        isGroup: true,
        dir: "in",
        state: "calling",
        dialedAt,
        now,
      }),
      true,
    )

    // Đã qua 35s
    assert.equal(
      shouldTimeoutUnansweredGroupMember({
        isGroup: true,
        dir: "in",
        state: "calling",
        dialedAt,
        now: dialedAt + 35_000,
      }),
      true,
    )
  })

  it("chưa đủ 30 giây → TIẾP TỤC ĐỔ CHUÔNG (false)", () => {
    const dialedAt = 1_000_000
    const now = dialedAt + 15_000 // mới 15s

    assert.equal(
      shouldTimeoutUnansweredGroupMember({
        isGroup: true,
        dir: "in",
        state: "calling",
        dialedAt,
        now,
      }),
      false,
    )
  })

  it("đã bắt máy (in-call hoặc connecting) → KHÔNG ngắt (false)", () => {
    const dialedAt = 1_000_000
    const now = dialedAt + 40_000

    assert.equal(
      shouldTimeoutUnansweredGroupMember({
        isGroup: true,
        dir: "in",
        state: "in-call",
        dialedAt,
        now,
      }),
      false,
    )

    assert.equal(
      shouldTimeoutUnansweredGroupMember({
        isGroup: true,
        dir: "in",
        state: "connecting",
        dialedAt,
        now,
      }),
      false,
    )
  })

  it("cuộc gọi ĐI (dir === out) → KHÔNG áp dụng timeout người nhận (false)", () => {
    const dialedAt = 1_000_000
    const now = dialedAt + 40_000

    assert.equal(
      shouldTimeoutUnansweredGroupMember({
        isGroup: true,
        dir: "out",
        state: "calling",
        dialedAt,
        now,
      }),
      false,
    )
  })

  it("cuộc gọi 1-1 (isGroup === false) → KHÔNG áp dụng luật nhóm (false)", () => {
    const dialedAt = 1_000_000
    const now = dialedAt + 35_000

    assert.equal(
      shouldTimeoutUnansweredGroupMember({
        isGroup: false,
        dir: "in",
        state: "calling",
        dialedAt,
        now,
      }),
      false,
    )
  })
})
