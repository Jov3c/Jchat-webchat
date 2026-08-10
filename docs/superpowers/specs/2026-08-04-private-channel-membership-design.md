# Private Channel Membership Design

## Goal

Keep two permanent public channels named `公共频道1` and `公共频道2`. Channels created by a user are private: the creator owns the channel and is its first member. Only the owner and invited members can discover, join, or use a private channel.

## Data model

The existing SQLite `channels` row continues to store a member-id list. It gains an `owner_id` column. A missing owner identifies a public channel; the two named public channels are always returned to authenticated users.

## API and authorization

- `GET /api/channels` is authenticated and returns the two public channels plus private channels whose member list contains the current user.
- `POST /api/channels` creates a private channel with `owner_id` and `members` set to the authenticated user.
- `POST /api/channel/:channel/members` accepts one or more usernames, resolves them to users, and adds them to a private channel. Only its owner can call it.
- Existing channel-member reads and removals are restricted to the channel owner. The owner cannot remove themself.
- Access checks for HTTP actions and Socket.IO joins reject users who are not private-channel members.

## Client behaviour

The new-channel action creates a private channel. Its detail panel exposes an Invite members floating card with two tabs: a selectable friend checklist and exact username entry. Inviting one or more valid users refreshes the channel list and signals invited users to refresh theirs.

## Migration

On startup, legacy `General` and `Technology` defaults are removed from the logical default list and replaced by the two Chinese public names. Existing user-created rows remain private. Existing rows with a password preserve their current member list; their owner is left unset until explicitly managed by an administrator, avoiding an unsafe accidental ownership assignment.

## Test coverage

- Default public channel names are exactly `公共频道1` and `公共频道2`.
- A newly created channel is visible to its creator but not another authenticated user.
- Owner invitation by username makes the channel visible to the invitee.
- A non-owner cannot invite or remove members.
- A non-member cannot join a private channel over the socket path.
