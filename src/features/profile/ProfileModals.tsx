import { ChangePasswordModal } from "../../components/ChangePasswordModal"
import { ChangeEmailModal } from "../../components/ChangeEmailModal"
import { FindFriendsModal } from "../../components/FindFriendsModal"
import { ProfilePanel, type ProfileData } from "../../components/ProfilePanel"
import type { InviteTarget } from "../../lib/link"
import type { ApiRoom, Relation } from "../../lib/api"

export interface ViewContext {
  isBlocked: boolean
  isFriend: boolean
  phoneVisible: boolean
  publicId?: string
  online?: boolean
  relation?: Relation
  requestId?: number
}

interface ProfileModalsProps {
  showChangePass: boolean
  setShowChangePass: (show: boolean) => void
  showChangeEmail: boolean
  setShowChangeEmail: (show: boolean) => void
  profileOpen: boolean
  setProfileOpen: (open: boolean) => void
  profile: ProfileData
  phonePublic: boolean
  blockedUsers: { id: number; name: string; initials: string }[]
  onSaveProfile: (p: ProfileData) => void
  onUnblockById: (id: number, name: string) => void
  onTogglePhonePublic: () => void
  onEmailUpdated: (email: string) => void
  onSessionEnded: () => void
  showFindFriends: boolean
  setShowFindFriends: (show: boolean) => void
  findSeed: InviteTarget | null
  setFindSeed: (seed: InviteTarget | null) => void
  onInviteConsumed?: () => void
  onJoinJoinedRoomApi: (room: ApiRoom) => void
  onRefreshRooms: () => void
  onOpenOtherProfile: (base: {
    name: string
    initials: string
    avatar?: string
    publicId?: string
    relation?: Relation
    requestId?: number
    isFriend?: boolean
  }) => void
  viewProfile: ProfileData | null
  setViewProfile: (profile: ProfileData | null) => void
  viewCtx: ViewContext
  onViewUnblock: () => void
  onViewBlock: () => void
  onOpenChatWith: (name: string, initials: string, publicId?: string) => void
  pushToast: (msg: string) => void
}

export function ProfileModals({
  showChangePass,
  setShowChangePass,
  showChangeEmail,
  setShowChangeEmail,
  profileOpen,
  setProfileOpen,
  profile,
  phonePublic,
  blockedUsers,
  onSaveProfile,
  onUnblockById,
  onTogglePhonePublic,
  onEmailUpdated,
  onSessionEnded,
  showFindFriends,
  setShowFindFriends,
  findSeed,
  setFindSeed,
  onInviteConsumed,
  onJoinJoinedRoomApi,
  onRefreshRooms,
  onOpenOtherProfile,
  viewProfile,
  setViewProfile,
  viewCtx,
  onViewUnblock,
  onViewBlock,
  onOpenChatWith,
  pushToast,
}: ProfileModalsProps) {
  return (
    <>
      {showChangePass && (
        <ChangePasswordModal
          onPushToast={pushToast}
          onSessionEnded={onSessionEnded}
          onClose={() => setShowChangePass(false)}
        />
      )}

      {showChangeEmail && (
        <ChangeEmailModal
          currentEmail={profile.email}
          onPushToast={pushToast}
          onUpdated={onEmailUpdated}
          onSessionEnded={onSessionEnded}
          onClose={() => setShowChangeEmail(false)}
        />
      )}

      {profileOpen && (
        <ProfilePanel
          mode="self"
          profile={profile}
          phonePublic={phonePublic}
          blockedUsers={blockedUsers}
          onSave={onSaveProfile}
          onUnblock={onUnblockById}
          onChangePassword={() => setShowChangePass(true)}
          onChangeEmail={() => setShowChangeEmail(true)}
          onTogglePhonePublic={onTogglePhonePublic}
          onPushToast={pushToast}
          onClose={() => setProfileOpen(false)}
        />
      )}

      {showFindFriends && (
        <FindFriendsModal
          onClose={() => {
            setShowFindFriends(false)
            setFindSeed(null)
            onInviteConsumed?.()
          }}
          onJoinRoom={onJoinJoinedRoomApi}
          onFriendAccepted={onRefreshRooms}
          onViewUser={(u) => {
            if (u.relation === "self") {
              setProfileOpen(true)
              return
            }
            setShowFindFriends(false)
            onOpenOtherProfile({
              name: u.name,
              initials: u.initials,
              avatar: u.avatar,
              publicId: u.publicId,
              relation: u.relation,
              requestId: u.requestId,
              isFriend: u.relation === "friend",
            })
          }}
          initialTarget={findSeed}
          onConsumedInvite={() => {
            setFindSeed(null)
            onInviteConsumed?.()
          }}
        />
      )}

      {viewProfile && (
        <ProfilePanel
          mode="other"
          profile={viewProfile}
          publicId={viewCtx.publicId}
          online={viewCtx.online}
          initialRelation={viewCtx.relation}
          initialRequestId={viewCtx.requestId}
          isBlocked={viewCtx.isBlocked}
          isFriend={viewCtx.isFriend}
          phoneVisible={viewCtx.phoneVisible}
          blockedUsers={blockedUsers}
          onUnblock={onViewUnblock}
          onMessage={() =>
            onOpenChatWith(viewProfile.name, viewProfile.initials, viewCtx.publicId)
          }
          onBlockUser={onViewBlock}
          onFriendAccepted={onRefreshRooms}
          onPushToast={pushToast}
          onClose={() => setViewProfile(null)}
        />
      )}
    </>
  )
}
