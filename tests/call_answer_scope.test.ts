import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { shouldMarkAnsweredByPeer } from "../src/lib/callGuard.ts"

/**
 * HỒI QUY: cuộc gọi NHÓM chỉ cho 2 người.
 *
 * Trong cuộc gọi nhóm, Peer Core phát khung `accept` của người vừa trả lời cho CẢ PHÒNG.
 * Máy thứ 3 đang đổ chuông (cuộc gọi ĐẾN) nhận được khung này và trước đây tự chuyển sang
 * "đang kết nối" → mất nút "Trả lời" nên không thể vào cuộc gọi.
 *
 * Quy tắc: chỉ bên GỌI ĐI (dir === "out") mới được đổi trạng thái khi nhận accept/answer.
 */
describe("shouldMarkAnsweredByPeer - chỉ bên gọi đi mới đổi trạng thái", () => {
  it("cuộc gọi ĐI đúng callId → có đổi trạng thái", () => {
    assert.equal(
      shouldMarkAnsweredByPeer({
        currentDir: "out",
        currentCallId: "c100-abc",
        currentRoomId: 12,
        frameCallId: "c100-abc",
        frameRoomId: 12,
      }),
      true,
    )
  })

  it("cuộc gọi ĐI khớp roomId kiểu khung cũ (không có callId) → có đổi trạng thái", () => {
    assert.equal(
      shouldMarkAnsweredByPeer({
        currentDir: "out",
        currentCallId: "c100-abc",
        currentRoomId: 12,
        frameRoomId: 12,
      }),
      true,
    )
  })

  it("ĐANG ĐỔ CHUÔNG cuộc gọi đến nhận accept broadcast của phòng → KHÔNG đổi trạng thái", () => {
    assert.equal(
      shouldMarkAnsweredByPeer({
        currentDir: "in",
        currentCallId: "c100-abc",
        currentRoomId: 12,
        frameCallId: "c100-abc",
        frameRoomId: 12,
      }),
      false,
    )
  })

  it("không có cuộc gọi cục bộ → KHÔNG đổi trạng thái", () => {
    assert.equal(
      shouldMarkAnsweredByPeer({
        frameCallId: "c100-abc",
        frameRoomId: 12,
      }),
      false,
    )
  })

  it("cuộc gọi ĐI nhưng accept của cuộc gọi khác → KHÔNG đổi trạng thái", () => {
    assert.equal(
      shouldMarkAnsweredByPeer({
        currentDir: "out",
        currentCallId: "c100-abc",
        currentRoomId: 12,
        frameCallId: "c200-def",
        frameRoomId: 99,
      }),
      false,
    )
  })

  it("so khớp roomId dạng số/chuỗi vẫn đúng", () => {
    assert.equal(
      shouldMarkAnsweredByPeer({
        currentDir: "out",
        currentCallId: "c100-abc",
        currentRoomId: 12,
        frameRoomId: Number("12"),
      }),
      true,
    )
  })
})
