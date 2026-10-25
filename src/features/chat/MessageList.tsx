import React, { Fragment } from "react"
import type { Message, Conversation } from "../../types/chat"
import { CallEventCard } from "../../components/CallEventCard"
import { Avatar } from "../../components/Avatar"
import { initialsOf } from "../../lib/callView"
import { MessageActions, ReactionBadge } from "./MessageActions"
import { QuoteBlock } from "./bubbles/QuoteBlock"
import { VoiceBubble } from "./bubbles/VoiceBubble"
import { FileBubble } from "./bubbles/FileBubble"
import { MsgAck, readAck } from "./bubbles/MsgAck"
import { callEventFromMessage, type CallMedia } from "../../lib/callEvent"
import type { CallKind } from "../../lib/peer"
import { getUserProfile } from "../../lib/personDirectory"
import { ENCRYPTED_PREVIEW, messageContentDisplay } from "../../lib/conversationPreview"

const MIN_MS = 60 * 1000
const HOUR_MS = 60 * MIN_MS
const DAY_MS = 24 * HOUR_MS

const WEEKDAYS = [
  "Chủ nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
]

export function startOfDayTs(ts: number) {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function dayLabel(ts: number) {
  const diff = Math.round(
    (startOfDayTs(Date.now()) - startOfDayTs(ts)) / DAY_MS,
  )
  if (diff <= 0) return "Hôm nay"
  if (diff === 1) return "Hôm qua"
  if (diff < 7) return WEEKDAYS[new Date(ts).getDay()]
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  return `${dd}/${mm}/${d.getFullYear()}`
}

export function senderKey(m: Message) {
  return m.fromMe ? "__me__" : (m.senderName ?? "?")
}

export function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex justify-center">
      <span
        className="px-3 py-1 rounded-full text-[11px] font-medium"
        style={{
          backgroundColor: "var(--surface)",
          color: "var(--muted)",
          border: "1px solid var(--border)",
        }}
      >
        {label}
      </span>
    </div>
  )
}

export interface MessageListProps {
  scrollRef: React.RefObject<HTMLDivElement | null>
  chatEndRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
  onDragEnter: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  dragOver: boolean
  selected: Conversation
  visibleMessages: Message[]
  meId: number
  activeActionsId: number | null
  setActiveActionsId: React.Dispatch<React.SetStateAction<number | null>>
  jumpId: number | null
  searchCurId: number | null
  highlightBody: (text: string) => React.ReactNode
  startEdit: (msg: Message) => void
  recallEveryone: (id: number) => void
  deleteForMe: (id: number) => void
  toggleReaction: (id: number, emoji: string) => void
  openShare: (msg: Message) => void
  startReply: (msg: Message) => void
  jumpToMessage: (id: number) => void
  openLightbox: (msgId: number) => void
  setReactionMsgId: (id: number | null) => void
  setReactionTab: (tab: string | null) => void
  setSeenModalMsg: (msg: Message | null) => void
  retryOutgoing: (roomId: number, clientId?: string) => void
  call: any
  callDur: number
  startCall: (kind: CallKind, conv?: Conversation) => Promise<void> | void
  showJump: boolean
  jumpToBottom: () => void
  historyLoading?: boolean
  /** Tải tệp qua Peer Core cục bộ (vé một lần) khi bubble chưa có blob URL. */
  onDownloadFile?: (msg: Message) => void
  onCancelFile?: (fileId: string) => void
  onRetryFile?: (fileId: string) => void
  e2eUnlocked?: boolean
}

export function MessageList({
  scrollRef,
  chatEndRef,
  onScroll,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOver,
  selected,
  visibleMessages,
  meId,
  activeActionsId,
  setActiveActionsId,
  jumpId,
  searchCurId,
  highlightBody,
  startEdit,
  recallEveryone,
  deleteForMe,
  toggleReaction,
  openShare,
  startReply,
  jumpToMessage,
  openLightbox,
  setReactionMsgId,
  setReactionTab,
  setSeenModalMsg,
  retryOutgoing,
  call,
  callDur,
  startCall,
  showJump,
  jumpToBottom,
  historyLoading = false,
  onDownloadFile,
  onCancelFile,
  onRetryFile,
  e2eUnlocked = true,
}: MessageListProps) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => setActiveActionsId(null)}
      className="relative flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-3"
      style={
        selected.bg
          ? {
              backgroundImage: `linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.2)), url(${selected.bg})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }
          : undefined
      }
    >
      {dragOver && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
        >
          <div
            className="px-6 py-3 rounded-xl text-sm font-semibold"
            style={{
              backgroundColor: "var(--bg)",
              color: "var(--text)",
              border: "2px dashed var(--primary)",
            }}
          >
            Thả ảnh hoặc file để gửi
          </div>
        </div>
      )}
      {historyLoading && (
        <div className="flex flex-col gap-2 py-2 items-center justify-center animate-pulse">
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <span className="w-3.5 h-3.5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
            <span>Đang nạp tin nhắn cũ…</span>
          </div>
        </div>
      )}
      {visibleMessages.map((msg, i) => {
        const isImageMsg = !!msg.file?.isImage && !!msg.file?.url
        const hasReactions = !!msg.reactions && msg.reactions.length > 0
        const curTs = msg.sentAt ?? Date.now()
        const prevRaw = i > 0 ? visibleMessages[i - 1] : null
        const nextRaw =
          i < visibleMessages.length - 1 ? visibleMessages[i + 1] : null
        const prevTs = prevRaw?.sentAt ?? 0
        const nextTs = nextRaw?.sentAt ?? 0
        const dayBreakUp =
          !!prevRaw && startOfDayTs(curTs) !== startOfDayTs(prevTs)
        const dayBreakNext =
          !!nextRaw && startOfDayTs(nextTs) !== startOfDayTs(curTs)
        const canClusterMsg = (m: Message) =>
          !m.like && !m.recalled && m.kind !== "call"
        const gapOk =
          !!prevRaw &&
          canClusterMsg(prevRaw) &&
          canClusterMsg(msg) &&
          !dayBreakUp &&
          curTs - prevTs > 0 &&
          curTs - prevTs <= 5 * MIN_MS
        const clustered =
          gapOk && !!prevRaw && senderKey(prevRaw) === senderKey(msg)
        const nextGapOk =
          !!nextRaw &&
          canClusterMsg(nextRaw) &&
          canClusterMsg(msg) &&
          !dayBreakNext &&
          nextTs - curTs > 0 &&
          nextTs - curTs <= 5 * MIN_MS
        const nextClustered =
          nextGapOk && !!nextRaw && senderKey(msg) === senderKey(nextRaw)
        const isMidCluster = clustered && nextClustered
        const dayDivider =
          (i === 0 || dayBreakUp) ? (
            <DayDivider label={dayLabel(curTs)} />
          ) : null
        const quoteTarget = (msg.replyId || msg.replyToClientId)
          ? selected.messages.find(
              (m) =>
                (msg.replyId && m.id === msg.replyId) ||
                (msg.replyToClientId &&
                  (m.clientId === msg.replyToClientId ||
                    (m.file?.fileId &&
                      (msg.replyToClientId === `file:${m.file.fileId}` ||
                        msg.replyToClientId === m.file.fileId)))),
            ) ?? null
          : null

        if (msg.kind === "call" && msg.call) {
          const event = callEventFromMessage(msg.call, meId)
          const mine = event.mine
          const members = selected.members ?? []
          const starter = members.find((m) => m.id === msg.call?.starterId)
          const dmPeer = selected.isGroup
            ? undefined
            : members.find((m) => m.id !== meId)
          const peerId =
            starter?.id ??
            dmPeer?.id ??
            (msg.senderId !== meId ? msg.senderId : undefined)
          const peerProfile = getUserProfile(peerId)
          const peerName =
            peerProfile.displayName ||
            starter?.name ||
            msg.senderName ||
            dmPeer?.name ||
            selected.name

          return (
            <Fragment key={msg.id}>
              {dayDivider}
              <div className="my-1" onClick={(e) => e.stopPropagation()}>
                <CallEventCard
                  event={event}
                  mine={!!mine}
                  peerName={peerName}
                  peerId={peerId}
                  timeLabel={msg.time}
                  variant="full"
                  onCallBack={(media) => void startCall(media, selected)}
                />
              </div>
            </Fragment>
          )
        }

        if (msg.like) {
          const isMine = !!msg.fromMe
          const sender = selected.isGroup
            ? (selected.members ?? []).find((m) => m.id === msg.senderId)
            : undefined
          const profile = selected.isGroup ? getUserProfile(msg.senderId) : undefined
          const memberNick =
            selected.isGroup && msg.senderId
              ? selected.nicknames?.[msg.senderId]
              : undefined
          const senderDisplayName =
            memberNick ||
            msg.senderName ||
            sender?.name ||
            profile?.displayName ||
            "Thành viên"
          const senderAvatar = sender?.avatar || profile?.avatarUrl
          const senderInitials =
            msg.senderInitials ||
            sender?.initials ||
            profile?.initials ||
            initialsOf(senderDisplayName)
          const hasReactions = !!msg.reactions && msg.reactions.length > 0

          return (
            <Fragment key={msg.id}>
              {dayDivider}
              <div
                id={`msg-${msg.id}`}
                className={`flex ${isMine ? "justify-end" : "justify-start items-start gap-2"}${
                  clustered ? " -mt-2" : ""
                }${jumpId === msg.id ? " msg-flash" : ""}`}
                onMouseEnter={() => setActiveActionsId(msg.id)}
                onMouseLeave={() =>
                  setActiveActionsId((cur) => (cur === msg.id ? null : cur))
                }
                onPointerDown={(e) => {
                  if (e.pointerType !== "mouse") setActiveActionsId(msg.id)
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {!isMine && selected.isGroup && (
                  clustered ? (
                    <div className="w-7 flex-shrink-0" />
                  ) : (
                    <div className="flex-shrink-0 mt-2">
                      <Avatar
                        sizePx={28}
                        src={senderAvatar}
                        name={senderDisplayName}
                        initials={senderInitials}
                        showPresence={false}
                      />
                    </div>
                  )
                )}
                <div className="relative max-w-xs">
                  <MessageActions
                    msg={msg}
                    active={activeActionsId === msg.id}
                    side={isMine ? "left" : "right"}
                    onEdit={startEdit}
                    onRecall={recallEveryone}
                    onDelete={deleteForMe}
                    onReact={toggleReaction}
                    onShare={openShare}
                    onReply={startReply}
                  />
                  {!isMine && selected.isGroup && !clustered && (
                    <p
                      className="text-xs font-medium mb-1 px-1"
                      style={{ color: "var(--muted)" }}
                    >
                      {senderDisplayName}
                    </p>
                  )}
                  <div
                    className={`flex items-center ${isMine ? "justify-end" : "justify-start"}`}
                    style={{
                      color: "var(--chat-theme-color)",
                      marginBottom: hasReactions ? "12px" : "0px",
                      transition: "margin-bottom 0.16s ease",
                    }}
                  >
                    <span className="text-3xl leading-none select-none hover:scale-110 transition-transform">
                      {msg.text}
                    </span>
                  </div>
                  {msg.reactions && msg.reactions.length > 0 && (
                    <ReactionBadge
                      reactions={msg.reactions}
                      side={isMine ? "mine" : "other"}
                      onOpen={() => {
                        setReactionMsgId(msg.id)
                        setReactionTab(null)
                      }}
                    />
                  )}
                  <p
                    className={`text-xs mt-1 px-1 flex items-center gap-1 ${
                      isMine ? "justify-end" : "justify-start"
                    }`}
                    style={{ color: "var(--muted)" }}
                  >
                    {msg.time}
                    {isMine && (
                      <MsgAck
                        ack={readAck(msg, selected)}
                        conv={selected}
                        onOpenSeen={() => setSeenModalMsg(msg)}
                        onRetry={() =>
                          retryOutgoing(selected.realId ?? 0, msg.clientId)
                        }
                      />
                    )}
                  </p>
                </div>
              </div>
            </Fragment>
          )
        }

        if (msg.fromMe) {
          if (msg.recalled) {
            return (
              <div
                key={msg.id}
                className="flex justify-end"
                onMouseEnter={() => setActiveActionsId(msg.id)}
                onMouseLeave={() =>
                  setActiveActionsId((cur) => (cur === msg.id ? null : cur))
                }
                onPointerDown={(e) => {
                  if (e.pointerType !== "mouse") setActiveActionsId(msg.id)
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="relative max-w-xs">
                  <MessageActions
                    msg={msg}
                    active={activeActionsId === msg.id}
                    side="left"
                    onEdit={startEdit}
                    onRecall={recallEveryone}
                    onDelete={deleteForMe}
                    onReact={toggleReaction}
                    onShare={openShare}
                    onReply={startReply}
                  />
                  <div
                    className="px-4 py-2 rounded-2xl text-sm italic text-center"
                    style={{
                      backgroundColor: "var(--surface)",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Tin nhắn đã được thu hồi
                  </div>
                  <p
                    className="text-xs mt-1 px-1 flex items-center gap-1 justify-end"
                    style={{ color: "var(--muted)" }}
                  >
                    {msg.time}
                  </p>
                </div>
              </div>
            )
          }

          return (
            <Fragment key={msg.id}>
              {dayDivider}
              <div
                id={`msg-${msg.id}`}
                className={`flex justify-end${
                  clustered ? " -mt-2" : ""
                }${jumpId === msg.id ? " msg-flash" : ""}`}
                style={{
                  outline:
                    searchCurId === msg.id
                      ? "2px solid var(--primary)"
                      : "none",
                  outlineOffset: 2,
                  borderRadius: 10,
                }}
                onMouseEnter={() => setActiveActionsId(msg.id)}
                onMouseLeave={() =>
                  setActiveActionsId((cur) => (cur === msg.id ? null : cur))
                }
                onPointerDown={(e) => {
                  if (e.pointerType !== "mouse") setActiveActionsId(msg.id)
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="max-w-xs">
                  {msg.forwarded && (
                    <p
                      className="text-[10px] italic px-1 mb-0.5 text-right"
                      style={{ color: "var(--muted)" }}
                    >
                      Đã chuyển tiếp
                    </p>
                  )}
                  <div
                    className="relative"
                    style={{
                      marginBottom: hasReactions ? "12px" : "0px",
                      transition: "margin-bottom 0.16s ease",
                    }}
                  >
                    <MessageActions
                      msg={msg}
                      active={activeActionsId === msg.id}
                      side="left"
                      onEdit={startEdit}
                      onRecall={recallEveryone}
                      onDelete={deleteForMe}
                      onReact={toggleReaction}
                      onShare={openShare}
                      onReply={startReply}
                    />
                    {quoteTarget && (
                      <div className="mb-1.5">
                        <QuoteBlock
                          target={quoteTarget}
                          tone="other"
                          onJump={() => { if (quoteTarget) jumpToMessage(quoteTarget.id); else if (msg.replyId) jumpToMessage(msg.replyId); }}
                        />
                      </div>
                    )}
                    {isImageMsg ? (
                      <FileBubble
                        msg={msg}
                        fromMe
                        onOpenImage={openLightbox}
                        onDownload={onDownloadFile ? () => onDownloadFile(msg) : undefined}
                onCancel={onCancelFile && msg.file?.fileId ? () => onCancelFile(msg.file!.fileId!) : undefined}
                onRetry={onRetryFile && msg.file?.fileId ? () => onRetryFile(msg.file!.fileId!) : undefined}
                      />
                    ) : (
                      <div
                        className="px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                        style={{
                          backgroundColor: "var(--chat-theme-color)",
                          color: selected.theme
                            ? "#fff"
                            : "var(--primary-fg)",
                          borderBottomRightRadius: "4px",
                        }}
                      >
                        {msg.voice ? (
                          <VoiceBubble msg={msg} fromMe />
                        ) : msg.file ? (
                          <FileBubble
                            msg={msg}
                            fromMe
                            onOpenImage={openLightbox}
                            onDownload={onDownloadFile ? () => onDownloadFile(msg) : undefined}
                onCancel={onCancelFile && msg.file?.fileId ? () => onCancelFile(msg.file!.fileId!) : undefined}
                onRetry={onRetryFile && msg.file?.fileId ? () => onRetryFile(msg.file!.fileId!) : undefined}
                          />
                        ) : msg.tag ? (
                          <span className="font-medium">
                            {highlightBody(
                              messageContentDisplay(msg, e2eUnlocked),
                            )}
                          </span>
                        ) : (
                          highlightBody(
                            messageContentDisplay(msg, e2eUnlocked),
                          )
                        )}
                      </div>
                    )}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <ReactionBadge
                        reactions={msg.reactions}
                        side="mine"
                        onOpen={() => {
                          setReactionMsgId(msg.id)
                          setReactionTab(null)
                        }}
                      />
                    )}
                  </div>
                  {isMidCluster ? (
                    <div
                      className="text-xs mt-1 px-1 flex items-center justify-end"
                      style={{ color: "var(--muted)" }}
                    >
                      <MsgAck
                        ack={readAck(msg, selected)}
                        conv={selected}
                        onOpenSeen={() => setSeenModalMsg(msg)}
                        onRetry={() =>
                          retryOutgoing(selected.realId ?? 0, msg.clientId)
                        }
                      />
                    </div>
                  ) : (
                    <p
                      className="text-xs mt-1 px-1 flex items-center gap-1 justify-end"
                      style={{ color: "var(--muted)" }}
                    >
                      {msg.edited && (
                        <span className="italic">Đã chỉnh sửa ·</span>
                      )}
                      {msg.time}
                      <MsgAck
                        ack={readAck(msg, selected)}
                        conv={selected}
                        onOpenSeen={() => setSeenModalMsg(msg)}
                        onRetry={() =>
                          retryOutgoing(selected.realId ?? 0, msg.clientId)
                        }
                      />
                    </p>
                  )}
                </div>
              </div>
            </Fragment>
          )
        }

        if (selected.isGroup) {
          const sender = (selected.members ?? []).find((m) => m.id === msg.senderId)
          const profile = getUserProfile(msg.senderId)
          const memberNick = msg.senderId ? selected.nicknames?.[msg.senderId] : undefined
          const senderDisplayName = memberNick || msg.senderName || sender?.name || profile?.displayName || "Thành viên"
          const senderAvatar = sender?.avatar || profile?.avatarUrl
          const senderInitials = msg.senderInitials || sender?.initials || profile?.initials || initialsOf(senderDisplayName)

          if (msg.recalled) {
            return (
              <div
                key={msg.id}
                className="flex justify-start items-start gap-2"
                onMouseEnter={() => setActiveActionsId(msg.id)}
                onMouseLeave={() =>
                  setActiveActionsId((cur) => (cur === msg.id ? null : cur))
                }
                onPointerDown={(e) => {
                  if (e.pointerType !== "mouse") setActiveActionsId(msg.id)
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex-shrink-0 mt-5">
                  <Avatar
                    sizePx={28}
                    src={senderAvatar}
                    name={senderDisplayName}
                    initials={senderInitials}
                    showPresence={false}
                  />
                </div>
                <div className="relative max-w-xs">
                  <MessageActions
                    msg={msg}
                    active={activeActionsId === msg.id}
                    side="right"
                    onEdit={startEdit}
                    onRecall={recallEveryone}
                    onDelete={deleteForMe}
                    onReact={toggleReaction}
                    onShare={openShare}
                    onReply={startReply}
                  />
                  <p
                    className="text-xs font-medium mb-1 px-1"
                    style={{ color: "var(--muted)" }}
                  >
                    {senderDisplayName}
                  </p>
                  <div
                    className="px-4 py-2 rounded-2xl text-sm italic"
                    style={{
                      backgroundColor: "var(--surface)",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Tin nhắn đã được thu hồi
                  </div>
                  <p
                    className="text-xs mt-1 px-1"
                    style={{ color: "var(--muted)", textAlign: "left" }}
                  >
                    {msg.time}
                  </p>
                </div>
              </div>
            )
          }

          return (
            <Fragment key={msg.id}>
              {dayDivider}
              <div
                id={`msg-${msg.id}`}
                className={`flex justify-start items-start gap-2${
                  clustered ? " -mt-2" : ""
                }${jumpId === msg.id ? " msg-flash" : ""}`}
                style={{
                  outline:
                    searchCurId === msg.id
                      ? "2px solid var(--primary)"
                      : "none",
                  outlineOffset: 2,
                  borderRadius: 10,
                }}
                onMouseEnter={() => setActiveActionsId(msg.id)}
                onMouseLeave={() =>
                  setActiveActionsId((cur) => (cur === msg.id ? null : cur))
                }
                onPointerDown={(e) => {
                  if (e.pointerType !== "mouse") setActiveActionsId(msg.id)
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {clustered ? (
                  <div className="w-7 flex-shrink-0" />
                ) : (
                  <div className="flex-shrink-0 mt-5">
                    <Avatar
                      sizePx={28}
                      src={senderAvatar}
                      name={senderDisplayName}
                      initials={senderInitials}
                      showPresence={false}
                    />
                  </div>
                )}
                <div className="max-w-xs">
                  {!clustered && (
                    <p
                      className="text-xs font-medium mb-1 px-1"
                      style={{ color: "var(--muted)" }}
                    >
                      {senderDisplayName}
                    </p>
                  )}
                  {msg.forwarded && (
                    <p
                      className="text-[10px] italic px-1 mb-0.5"
                      style={{ color: "var(--muted)" }}
                    >
                      Đã chuyển tiếp
                    </p>
                  )}
                  <div
                    className="relative"
                    style={{
                      marginBottom: hasReactions ? "12px" : "0px",
                      transition: "margin-bottom 0.16s ease",
                    }}
                  >
                    <MessageActions
                      msg={msg}
                      active={activeActionsId === msg.id}
                      side="right"
                      onEdit={startEdit}
                      onRecall={recallEveryone}
                      onDelete={deleteForMe}
                      onReact={toggleReaction}
                      onShare={openShare}
                      onReply={startReply}
                    />
                    {quoteTarget && (
                      <div className="mb-1.5">
                        <QuoteBlock
                          target={quoteTarget}
                          tone="other"
                          onJump={() => { if (quoteTarget) jumpToMessage(quoteTarget.id); else if (msg.replyId) jumpToMessage(msg.replyId); }}
                        />
                      </div>
                    )}
                    {isImageMsg ? (
                      <FileBubble
                        msg={msg}
                        onOpenImage={openLightbox}
                        onDownload={onDownloadFile ? () => onDownloadFile(msg) : undefined}
                onCancel={onCancelFile && msg.file?.fileId ? () => onCancelFile(msg.file!.fileId!) : undefined}
                onRetry={onRetryFile && msg.file?.fileId ? () => onRetryFile(msg.file!.fileId!) : undefined}
                      />
                    ) : (
                      <div
                        className="px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                        style={{
                          backgroundColor: "var(--surface)",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderBottomLeftRadius: "4px",
                        }}
                      >
                        {msg.voice ? (
                          <VoiceBubble msg={msg} />
                        ) : msg.file ? (
                          <FileBubble
                            msg={msg}
                            onOpenImage={openLightbox}
                            onDownload={onDownloadFile ? () => onDownloadFile(msg) : undefined}
                onCancel={onCancelFile && msg.file?.fileId ? () => onCancelFile(msg.file!.fileId!) : undefined}
                onRetry={onRetryFile && msg.file?.fileId ? () => onRetryFile(msg.file!.fileId!) : undefined}
                          />
                        ) : msg.tag ? (
                          <span className="font-medium">
                            {highlightBody(
                              messageContentDisplay(msg, e2eUnlocked),
                            )}
                          </span>
                        ) : (
                          highlightBody(
                            messageContentDisplay(msg, e2eUnlocked),
                          )
                        )}
                      </div>
                    )}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <ReactionBadge
                        reactions={msg.reactions}
                        side="other"
                        onOpen={() => {
                          setReactionMsgId(msg.id)
                          setReactionTab(null)
                        }}
                      />
                    )}
                  </div>
                  {!isMidCluster && (
                    <p
                      className="text-xs mt-1 px-1"
                      style={{
                        color: "var(--muted)",
                        textAlign: "left",
                      }}
                    >
                      {msg.edited && (
                        <span className="italic">Đã chỉnh sửa ·</span>
                      )}
                      {msg.time}
                    </p>
                  )}
                </div>
              </div>
            </Fragment>
          )
        }

        if (msg.recalled) {
          return (
            <div
              key={msg.id}
              className="flex justify-start"
              onMouseEnter={() => setActiveActionsId(msg.id)}
              onMouseLeave={() =>
                setActiveActionsId((cur) => (cur === msg.id ? null : cur))
              }
              onPointerDown={(e) => {
                if (e.pointerType !== "mouse") setActiveActionsId(msg.id)
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative max-w-xs">
                <MessageActions
                  msg={msg}
                  active={activeActionsId === msg.id}
                  side="right"
                  onEdit={startEdit}
                  onRecall={recallEveryone}
                  onDelete={deleteForMe}
                  onReact={toggleReaction}
                  onShare={openShare}
                  onReply={startReply}
                />
                <div
                  className="px-4 py-2 rounded-2xl text-sm italic"
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Tin nhắn đã được thu hồi
                </div>
                <p
                  className="text-xs mt-1 px-1"
                  style={{ color: "var(--muted)", textAlign: "left" }}
                >
                  {msg.time}
                </p>
              </div>
            </div>
          )
        }

        return (
          <Fragment key={msg.id}>
            {dayDivider}
            <div
              id={`msg-${msg.id}`}
              className={`flex justify-start${
                clustered ? " -mt-2" : ""
              }${jumpId === msg.id ? " msg-flash" : ""}`}
              style={{
                outline:
                  searchCurId === msg.id
                    ? "2px solid var(--primary)"
                    : "none",
                outlineOffset: 2,
                borderRadius: 10,
              }}
              onMouseEnter={() => setActiveActionsId(msg.id)}
              onMouseLeave={() =>
                setActiveActionsId((cur) => (cur === msg.id ? null : cur))
              }
              onPointerDown={(e) => {
                if (e.pointerType !== "mouse") setActiveActionsId(msg.id)
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="max-w-xs">
                {msg.forwarded && (
                  <p
                    className="text-[10px] italic px-1 mb-0.5"
                    style={{ color: "var(--muted)" }}
                  >
                    Đã chuyển tiếp
                  </p>
                )}
                <div
                  className="relative"
                  style={{
                    marginBottom: hasReactions ? "12px" : "0px",
                    transition: "margin-bottom 0.16s ease",
                  }}
                >
                  <MessageActions
                    msg={msg}
                    active={activeActionsId === msg.id}
                    side="right"
                    onEdit={startEdit}
                    onRecall={recallEveryone}
                    onDelete={deleteForMe}
                    onReact={toggleReaction}
                    onShare={openShare}
                    onReply={startReply}
                  />
                  {quoteTarget && (
                    <div className="mb-1.5">
                      <QuoteBlock
                        target={quoteTarget}
                        tone="mine"
                        onJump={() => { if (quoteTarget) jumpToMessage(quoteTarget.id); else if (msg.replyId) jumpToMessage(msg.replyId); }}
                      />
                    </div>
                  )}
                  {isImageMsg ? (
                    <FileBubble
                      msg={msg}
                      onOpenImage={openLightbox}
                      onDownload={onDownloadFile ? () => onDownloadFile(msg) : undefined}
                onCancel={onCancelFile && msg.file?.fileId ? () => onCancelFile(msg.file!.fileId!) : undefined}
                onRetry={onRetryFile && msg.file?.fileId ? () => onRetryFile(msg.file!.fileId!) : undefined}
                    />
                  ) : (
                    <div
                      className="px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                      style={{
                        backgroundColor: "var(--surface)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                        borderBottomLeftRadius: "4px",
                      }}
                    >
                      {msg.voice ? (
                        <VoiceBubble msg={msg} />
                      ) : msg.file ? (
                        <FileBubble
                          msg={msg}
                          onOpenImage={openLightbox}
                          onDownload={onDownloadFile ? () => onDownloadFile(msg) : undefined}
                onCancel={onCancelFile && msg.file?.fileId ? () => onCancelFile(msg.file!.fileId!) : undefined}
                onRetry={onRetryFile && msg.file?.fileId ? () => onRetryFile(msg.file!.fileId!) : undefined}
                        />
                      ) : msg.tag ? (
                        <span className="font-medium">
                          {highlightBody(
                            messageContentDisplay(msg, e2eUnlocked),
                          )}
                        </span>
                      ) : (
                        highlightBody(
                          messageContentDisplay(msg, e2eUnlocked),
                        )
                      )}
                    </div>
                  )}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <ReactionBadge
                      reactions={msg.reactions}
                      side="other"
                      onOpen={() => {
                        setReactionMsgId(msg.id)
                        setReactionTab(null)
                      }}
                    />
                  )}
                </div>
                {!isMidCluster && (
                  <p
                    className="text-xs mt-1 px-1"
                    style={{
                      color: "var(--muted)",
                      textAlign: "left",
                    }}
                  >
                    {msg.edited && (
                      <span className="italic">Đã chỉnh sửa ·</span>
                    )}
                    {msg.time}
                  </p>
                )}
              </div>
            </div>
          </Fragment>
        )
      })}

      {/* Thẻ "Cuộc gọi đang diễn ra" (chạy thời gian thực) — hiển thị từ trạng
          thái cuộc gọi trực tiếp, KHÔNG tạo sự kiện lưu (tránh trùng). */}
      {call &&
        call.state === "in-call" &&
        call.convId === selected.id && (
          <CallEventCard
            event={{
              media: call.kind,
              outcome: "ongoing",
              durationSec: 0,
              startedAt: call.startAt ?? call.dialedAt,
              starterId: call.callerId,
              participants: selected.isGroup
                ? selected.members?.length ?? 0
                : undefined,
              groupIds: selected.isGroup
                ? (selected.members ?? [])
                    .filter((m) => m.id !== meId)
                    .map((m) => m.id)
                : undefined,
              callId: call.callId,
            }}
            mine={call.dir === "out"}
            peerName={
              selected.isGroup
                ? selected.name
                : (selected.members ?? []).find((m) => m.id !== meId)?.name ??
                  selected.name
            }
            peerId={
              (selected.members ?? []).find((m) => m.id !== meId)?.id
            }
            liveSec={callDur}
            canJoin={!!selected.isGroup}
            onJoin={() => void startCall(call.kind, selected)}
          />
        )}
      <div ref={chatEndRef} />
      {showJump && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold shadow-lg transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary-fg)",
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Tin nhắn mới
        </button>
      )}
    </div>
  )
}
