import React from "react"
import { QuoteBlock } from "./bubbles/QuoteBlock"
import { VoiceBubble, makeBars } from "./bubbles/VoiceBubble"
import { EMOJI_DICT, themeIcon } from "./emojiData"
import type { Conversation, Message } from "../../types/chat"
import type { PeerClient } from "../../lib/peer"

export interface MessageInputProps {
  typing: { convId: number; name: string } | null
  selectedId: number | undefined
  selected: Conversation
  editingId: number | null
  cancelEdit: () => void
  replyToId: number | null
  cancelReply: () => void
  recState: "off" | "recording" | "preview"
  recUrl: string | null
  recDuration: number
  recSeconds: number
  sendVoice: () => void
  cancelPreview: () => void
  startRecording: () => void
  stopRecording: (cancel: boolean) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  imageInputRef: React.RefObject<HTMLInputElement | null>
  messageInputRef: React.RefObject<HTMLInputElement | null>
  handleFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleImageInput: (e: React.ChangeEvent<HTMLInputElement>) => void
  messageInput: string
  setMessageInput: React.Dispatch<React.SetStateAction<string>>
  peerOnRef: React.MutableRefObject<boolean>
  lastTypingSentRef: React.MutableRefObject<number>
  peerRef: React.MutableRefObject<PeerClient | null>
  peerReady: boolean
  sendMessage: () => void
  sendLike: () => void
  emojiOpen: boolean
  setEmojiOpen: React.Dispatch<React.SetStateAction<boolean>>
  emojiBtnRef: React.RefObject<HTMLButtonElement | null>
  emojiPanelRef: React.RefObject<HTMLDivElement | null>
  emojiQuery: string
  setEmojiQuery: React.Dispatch<React.SetStateAction<string>>
  emojiTab: "recent" | "all"
  setEmojiTab: React.Dispatch<React.SetStateAction<"recent" | "all">>
  recentEmojis: string[]
  insertEmojiAtCursor: (e: string) => void
  myMemberId?: number
}

export function MessageInput({
  typing,
  selectedId,
  selected,
  editingId,
  cancelEdit,
  replyToId,
  cancelReply,
  recState,
  recUrl,
  recDuration,
  recSeconds,
  sendVoice,
  cancelPreview,
  startRecording,
  stopRecording,
  fileInputRef,
  imageInputRef,
  messageInputRef,
  handleFileInput,
  handleImageInput,
  messageInput,
  setMessageInput,
  peerOnRef,
  lastTypingSentRef,
  peerRef,
  peerReady,
  sendMessage,
  sendLike,
  emojiOpen,
  setEmojiOpen,
  emojiBtnRef,
  emojiPanelRef,
  emojiQuery,
  setEmojiQuery,
  emojiTab,
  setEmojiTab,
  recentEmojis,
  insertEmojiAtCursor,
  myMemberId,
}: MessageInputProps) {
  const myRole = selected.isGroup
    ? (selected.members?.find((m) => m.id === myMemberId)?.role ?? "member")
    : null
  const isSendForbidden =
    selected.isGroup &&
    selected.settings?.allow_member_send === false &&
    myRole === "member"
  return (
    <>
      {/* Typing indicator */}
      <div
        className="h-6 px-5 flex items-center flex-shrink-0"
        style={{ color: "var(--muted)" }}
      >
        {typing && typing.convId === selectedId && (
          <span className="flex items-center gap-1.5 text-xs">
            <span>{typing.name} đang gõ</span>
            <span className="flex gap-0.5">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          </span>
        )}
      </div>

      {/* Composer */}
      <div
        className="relative flex-shrink-0"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        {editingId !== null && (
          <div
            className="px-4 pt-2 pb-0 flex items-center gap-2 text-xs"
            style={{ color: "var(--muted)" }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
            <span className="font-medium">Đang chỉnh sửa tin nhắn</span>
            <button
              onClick={cancelEdit}
              className="ml-auto px-2 py-1 rounded transition-opacity hover:opacity-70"
              style={{
                color: "var(--primary)",
              }}
            >
              Huỷ
            </button>
          </div>
        )}
        {replyToId !== null &&
          (() => {
            const t =
              selected.messages.find((m) => m.id === replyToId) ?? null
            return (
              <div
                className="px-4 pt-2 pb-0 flex items-center gap-2"
                style={{ color: "var(--muted)" }}
              >
                <div className="flex-1 min-w-0">
                  <QuoteBlock target={t} tone="other" />
                </div>
                <button
                  onClick={cancelReply}
                  className="p-1.5 rounded-md transition-opacity hover:opacity-70 flex-shrink-0"
                  style={{ color: "var(--muted)" }}
                  title="Huỷ trả lời"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )
          })()}
        {recState === "preview" && recUrl && (
          <div className="px-4 pt-2 pb-0 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <VoiceBubble
                msg={
                  {
                    id: 900000,
                    text: "đoạn ghi âm",
                    fromMe: true,
                    time: "",
                    voice: { url: recUrl, duration: recDuration },
                  } as Message
                }
                fromMe
              />
            </div>
            <button
              onClick={() => sendVoice()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0"
              style={{
                backgroundColor: "var(--primary)",
                color: "var(--primary-fg)",
              }}
            >
              Gửi
            </button>
            <button
              onClick={cancelPreview}
              className="p-1.5 rounded-md transition-opacity hover:opacity-70 flex-shrink-0"
              style={{ color: "var(--muted)" }}
              title="Huỷ tin nhắn thoại"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        {recState === "recording" ? (
          <div className="px-4 py-3 flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: "#ef4444",
                animation: "pulse 1.2s ease-in-out infinite",
              }}
            />
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span
              className="text-sm tabular-nums flex-shrink-0"
              style={{ color: "var(--text)" }}
            >
              {`${Math.floor(recSeconds / 60)}:${String(
                Math.floor(recSeconds % 60),
              ).padStart(2, "0")}`}
            </span>
            <span
              className="text-xs flex-shrink-0"
              style={{ color: "var(--muted)" }}
            >
              Đang ghi âm...
            </span>
            <div className="flex-1 flex items-center gap-[2px] h-6 overflow-hidden opacity-60">
              {makeBars(Date.now(), 44).map((b, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: `${b * 100}%`,
                    backgroundColor: "#ef4444",
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => stopRecording(true)}
              className="p-1.5 rounded-md transition-opacity hover:opacity-70 flex-shrink-0"
              style={{ color: "var(--muted)" }}
              title="Huỷ ghi âm"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <button
              onClick={() => stopRecording(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0"
              style={{
                backgroundColor: "var(--chat-theme-color)",
                color: "var(--chat-theme-fg)",
              }}
            >
              Dừng
            </button>
          </div>
        ) : (
          <div className="px-4 py-3 flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={handleImageInput}
            />
            <button
              onClick={() => {
                if (!isSendForbidden) fileInputRef.current?.click()
              }}
              disabled={isSendForbidden}
              className={`p-2 rounded-md transition-opacity flex-shrink-0 ${
                isSendForbidden
                  ? "opacity-30 cursor-not-allowed"
                  : "hover:opacity-60"
              }`}
              style={{ color: "var(--muted)" }}
              title={
                isSendForbidden
                  ? "Chỉ trưởng/phó nhóm được gửi tin"
                  : "Gửi file"
              }
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              onClick={() => {
                if (!isSendForbidden) imageInputRef.current?.click()
              }}
              disabled={isSendForbidden}
              className={`p-2 rounded-md transition-opacity flex-shrink-0 ${
                isSendForbidden
                  ? "opacity-30 cursor-not-allowed"
                  : "hover:opacity-60"
              }`}
              style={{ color: "var(--muted)" }}
              title={
                isSendForbidden
                  ? "Chỉ trưởng/phó nhóm được gửi tin"
                  : "Gửi ảnh/video"
              }
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <button
              className={`p-2 rounded-md transition-opacity flex-shrink-0 ${
                isSendForbidden
                  ? "opacity-30 cursor-not-allowed"
                  : "hover:opacity-60"
              }`}
              style={{
                color: "var(--muted)",
              }}
              title={
                isSendForbidden
                  ? "Chỉ trưởng/phó nhóm được gửi tin"
                  : "Ghi âm thoại"
              }
              disabled={isSendForbidden}
              onClick={() => {
                if (isSendForbidden) return
                if (recState === "off") startRecording()
                else if (recState === "preview") cancelPreview()
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            <input
              ref={messageInputRef}
              type="text"
              value={messageInput}
              onChange={(e) => {
                const v = e.target.value
                setMessageInput(v)
                const roomId = selected.realId
                if (roomId && v && peerOnRef.current && !isSendForbidden) {
                  const nowMs = Date.now()
                  if (nowMs - lastTypingSentRef.current > 2000) {
                    lastTypingSentRef.current = nowMs
                    peerRef.current?.send({ type: "typing", roomId })
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (!isSendForbidden) {
                    sendMessage()
                  }
                }
              }}
              placeholder={
                isSendForbidden
                  ? "Chỉ trưởng/phó nhóm được gửi tin"
                  : !selected.isGroup && selected.blocked
                    ? "Người dùng đã bị chặn"
                    : !peerOnRef.current
                      ? "Peer Core chưa kết nối..."
                      : !peerReady
                        ? "Chưa mở khoá E2E — mở khoá ở menu bên trái để gửi tin"
                        : "Nhập tin nhắn..."
              }
              className="flex-1 px-3 py-2 text-sm rounded-md outline-none"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
              disabled={
                isSendForbidden ||
                (!selected.isGroup && !!selected.blocked) ||
                !peerReady
              }
            />
            <div className="relative flex-shrink-0">
              <button
                ref={emojiBtnRef}
                onClick={() => {
                  if (isSendForbidden) return
                  setEmojiOpen((v) => !v)
                  setEmojiQuery("")
                }}
                disabled={isSendForbidden}
                className={`p-2 rounded-md transition-opacity ${
                  isSendForbidden
                    ? "opacity-30 cursor-not-allowed"
                    : "hover:opacity-60"
                }`}
                style={{
                  color: "var(--muted)",
                  fontSize: 18,
                  lineHeight: 1,
                }}
                title={
                  isSendForbidden
                    ? "Chỉ trưởng/phó nhóm được gửi tin"
                    : "Chèn biểu tượng cảm xúc"
                }
              >
                😊
              </button>
              {emojiOpen &&
                (() => {
                  const q = emojiQuery.trim().toLowerCase()
                  const hits = q
                    ? EMOJI_DICT.filter(([e, kw]) =>
                        kw.some((k) => k.toLowerCase().includes(q)),
                      ).map(([e]) => e)
                    : null
                  const shown = hits
                    ? hits
                    : emojiTab === "recent" && recentEmojis.length > 0
                      ? recentEmojis
                      : EMOJI_DICT.map(([e]) => e)
                  return (
                    <div
                      ref={emojiPanelRef}
                      className="absolute bottom-full right-0 mb-2 w-[304px] rounded-xl shadow-xl overflow-hidden flex flex-col"
                      style={{
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--border)",
                        zIndex: 60,
                        maxHeight: "min(360px, 60vh)",
                      }}
                    >
                      <div
                        className="px-2.5 py-2 flex items-center gap-2"
                        style={{
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ color: "var(--muted)", flexShrink: 0 }}
                        >
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                          type="text"
                          value={emojiQuery}
                          onChange={(e) => setEmojiQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && shown[0])
                              insertEmojiAtCursor(shown[0])
                          }}
                          placeholder="Tìm kiếm emoji..."
                          className="flex-1 text-sm outline-none bg-transparent"
                          style={{ color: "var(--text)" }}
                        />
                        {emojiQuery && (
                          <button
                            onClick={() => setEmojiQuery("")}
                            className="p-0.5 rounded transition-opacity hover:opacity-70"
                            style={{ color: "var(--muted)" }}
                            title="Xoá từ khoá"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {!q && (
                        <div className="px-2 pt-2 pb-1 flex gap-1">
                          {([
                            ["recent", "Gần đây"],
                            ["all", "Tất cả"],
                          ] as const).map(([tab, label]) => (
                            <button
                              key={tab}
                              onClick={() => setEmojiTab(tab)}
                              className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                              style={{
                                backgroundColor:
                                  emojiTab === tab
                                    ? "var(--primary)"
                                    : "var(--border)",
                                color:
                                  emojiTab === tab
                                    ? "var(--primary-fg)"
                                    : "var(--muted)",
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="overflow-y-auto p-2 grid grid-cols-8 gap-0.5 no-scrollbar">
                        {shown.map((e) => (
                          <button
                            key={e}
                            onClick={() => insertEmojiAtCursor(e)}
                            className="h-8 flex items-center justify-center rounded-lg text-lg hover:scale-110 hover:brightness-90 transition-transform"
                            style={{ backgroundColor: "transparent" }}
                            title={e}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      {shown.length === 0 && (
                        <div
                          className="px-3 py-6 text-center text-xs"
                          style={{ color: "var(--muted)" }}
                        >
                          Không tìm thấy emoji phù hợp
                        </div>
                      )}
                    </div>
                  )
                })()}
            </div>
            <button
              onClick={() => {
                if (isSendForbidden) return
                if (editingId !== null || messageInput.trim()) {
                  sendMessage()
                } else {
                  sendLike()
                }
              }}
              disabled={
                isSendForbidden || (!selected.isGroup && !!selected.blocked)
              }
              className={`p-2 rounded-md flex-shrink-0 transition-opacity ${
                isSendForbidden
                  ? "opacity-30 cursor-not-allowed"
                  : "hover:opacity-85"
              }`}
              style={{
                color:
                  editingId !== null
                    ? "var(--primary)"
                    : messageInput.trim()
                      ? "var(--primary)"
                      : (selected.theme ?? "var(--primary)"),
                opacity: isSendForbidden
                  ? 0.3
                  : editingId !== null || messageInput.trim()
                    ? 1
                    : 0.85,
                cursor: isSendForbidden ? "not-allowed" : "pointer",
              }}
              title={
                isSendForbidden
                  ? "Chỉ trưởng/phó nhóm được gửi tin"
                  : editingId !== null
                    ? "Lưu chỉnh sửa"
                    : messageInput.trim()
                      ? "Gửi"
                      : "Thích"
              }
            >
              {editingId !== null ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : messageInput.trim() ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              ) : (
                <span
                  className="text-xl leading-none"
                  style={{ color: "var(--chat-theme-color)" }}
                >
                  {selected.favEmoji ?? themeIcon(selected)}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
