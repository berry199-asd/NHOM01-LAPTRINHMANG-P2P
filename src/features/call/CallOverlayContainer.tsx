import { CallOverlay, CallStreamAudio } from "../../components/CallOverlay"
import type { CallNetHint } from "../../lib/callView"
import type { useCallManager } from "./useCallManager"

export interface CallOverlayContainerProps {
  callManager: ReturnType<typeof useCallManager>
  netQuality: CallNetHint
}

export function CallOverlayContainer({
  callManager,
  netQuality,
}: CallOverlayContainerProps) {
  const {
    call,
    callDur,
    callMuted,
    callVideoOff,
    callMinimized,
    callLocalStream,
    callRemoteStreams,
    callRemoteMediaState,
    callRoster,
    callTotalCount,
    hangUp,
    acceptIncoming,
    retryFailed,
    toggleMute,
    toggleVideo,
    toggleMinimize,
  } = callManager

  if (!call) return null

  // Kết hợp chất lượng mạng từ WebRTC và mạng tổng thể
  const effectiveNet = (callManager.callNetQuality && callManager.callNetQuality !== "good")
    ? callManager.callNetQuality
    : netQuality

  const remoteEntries = Object.entries(callRemoteStreams)

  return (
    <>
      {/* 
        Thẻ <audio> phát luồng âm thanh remote luôn được mount tại CallOverlayContainer.
        Tồn tại xuyên suốt cuộc gọi bất kể ở chế độ toàn màn hình, thu nhỏ hay thu gọn thành bubble.
      */}
      {remoteEntries.map(([uid, st]) => (
        <CallStreamAudio key={`persistent-audio-${uid}`} stream={st} />
      ))}

      <CallOverlay
        call={call}
        dur={callDur}
        muted={callMuted}
        videoOff={callVideoOff}
        localStream={callLocalStream}
        remoteStreams={callRemoteStreams}
        remoteMediaState={callRemoteMediaState}
        roster={callRoster}
        netHint={effectiveNet}
        totalCount={callTotalCount}
        minimized={callMinimized}
        onToggleMinimize={toggleMinimize}
        onHangUp={hangUp}
        onAccept={acceptIncoming}
        onRetry={retryFailed}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
      />
    </>
  )
}
