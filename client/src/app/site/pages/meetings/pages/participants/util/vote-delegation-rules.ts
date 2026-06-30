import { Id } from 'src/app/domain/definitions/key-types';

/**
 * Shared compatibility checks for the vote-delegation selectors. These mirror
 * the backend validator (`meeting_user/mixin.py` `check_vote_delegated_to_ids` /
 * `check_vote_delegations_from_ids`) and are the part that must stay in sync with
 * it, so they live in one place and are unit-tested here.
 *
 * All `*MeetingUserIds` arguments are `meeting_user` ids; `ownMeetingUserId` is
 * the current user's `meeting_user` id in the active meeting (or `undefined`).
 * The surrounding per-component orchestration (id space, `canDelegateVote`,
 * permission gates, …) intentionally stays in the components.
 */

/**
 * The target already delegates their vote somewhere other than to the current
 * user, so the current user may not additionally delegate to that target.
 */
export function targetHasIncompatibleOutgoingDelegation(
    targetDelegatedToMeetingUserIds: Id[],
    ownMeetingUserId: Id | undefined
): boolean {
    return (
        targetDelegatedToMeetingUserIds.length > 0 &&
        (ownMeetingUserId === undefined || !targetDelegatedToMeetingUserIds.includes(ownMeetingUserId))
    );
}

/**
 * Adding the current user as a delegate of the target would push the target over
 * its own delegation cap (unless the target already delegates to the current
 * user, in which case nothing new is added).
 */
export function targetWouldExceedMaxAmount(
    targetDelegatedToMeetingUserIds: Id[],
    ownMeetingUserId: Id | undefined,
    maxAmount: number
): boolean {
    const alreadyDelegatesToCurrent =
        ownMeetingUserId !== undefined && targetDelegatedToMeetingUserIds.includes(ownMeetingUserId);
    return !alreadyDelegatesToCurrent && targetDelegatedToMeetingUserIds.length >= maxAmount;
}

/**
 * The target already receives delegations from someone other than the current
 * user, so they may not (also) become the current user's delegate.
 */
export function targetReceivesIncompatibleDelegations(
    targetDelegationsFromMeetingUserIds: Id[],
    ownMeetingUserId: Id | undefined
): boolean {
    return (
        targetDelegationsFromMeetingUserIds.length > 0 &&
        (ownMeetingUserId === undefined ||
            targetDelegationsFromMeetingUserIds.length !== 1 ||
            targetDelegationsFromMeetingUserIds[0] !== ownMeetingUserId)
    );
}
