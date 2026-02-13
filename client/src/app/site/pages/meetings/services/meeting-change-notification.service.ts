import { Injectable } from '@angular/core';
import { NavigationEnd, Router, UrlTree } from '@angular/router';
import { BehaviorSubject, filter, Subscription } from 'rxjs';
import { Id } from 'src/app/domain/definitions/key-types';
import { Permission } from 'src/app/domain/definitions/permission';
import { AgendaItemRepositoryService } from 'src/app/gateways/repositories/agenda';
import { AssignmentRepositoryService } from 'src/app/gateways/repositories/assignments/assignment-repository.service/assignment-repository.service';
import { AssignmentCandidateRepositoryService } from 'src/app/gateways/repositories/assignments/assignment-candidate-repository.service/assignment-candidate-repository.service';
import { HistoryEntryRepositoryService } from 'src/app/gateways/repositories/history-entry/history-entry-repository.service';
import { ViewHistoryEntry } from 'src/app/gateways/repositories/history-entry/view-history-entry';
import { MeetingUserRepositoryService } from 'src/app/gateways/repositories/meeting_user';
import { MotionRepositoryService } from 'src/app/gateways/repositories/motions/motion-repository.service/motion-repository.service';
import { StorageService } from 'src/app/gateways/storage.service';
import { UserRepositoryService } from 'src/app/gateways/repositories/users';
import { MeetingUserFieldsets } from 'src/app/domain/fieldsets/user';
import { getAgendaListMinimalSubscriptionConfig } from 'src/app/site/pages/meetings/pages/agenda/agenda.subscription';
import { ViewAgendaItem } from 'src/app/site/pages/meetings/pages/agenda';
import { getMotionListSubscriptionConfig } from 'src/app/site/pages/meetings/pages/motions/motions.subscription';
import { ViewMotion } from 'src/app/site/pages/meetings/pages/motions/view-models';
import { OperatorService } from 'src/app/site/services/operator.service';
import { ModelData } from 'src/app/site/services/autoupdate/utils';
import { ModelRequestService } from 'src/app/site/services/model-request.service';
import { ViewMeetingUser } from 'src/app/site/pages/meetings/view-models/view-meeting-user';
import { ViewMeeting } from 'src/app/site/pages/meetings/view-models/view-meeting';

import { ActiveMeetingIdService } from './active-meeting-id.service';

const STORAGE_KEY = `os4-meeting-change-notifications`;
const MAX_NOTIFICATIONS_PER_MEETING = 100;
const NOTIFICATION_MOTION_SUBSCRIPTION = `meeting-notifications-motion-list`;
const NOTIFICATION_ASSIGNMENT_SUBSCRIPTION = `meeting-notifications-assignment-list`;
const NOTIFICATION_AGENDA_SUBSCRIPTION = `meeting-notifications-agenda-list`;
const NOTIFICATION_HISTORY_SUBSCRIPTION = `meeting-notifications-history-list`;
const NOTIFICATION_STATE_SUBSCRIPTION = `meeting-notifications-state`;

const HISTORY_ENTRY_MOTION_CREATED = `Motion created`;
const HISTORY_ENTRY_CANDIDATE_ADDED = `Candidate added`;
const HISTORY_ENTRY_AGENDA_ADDED = `Agenda item added`;
const HISTORY_ENTRY_AGENDA_UPDATED = `Agenda item updated`;
const HISTORY_ENTRY_AGENDA_REMOVED = `Agenda item removed`;

export type MeetingNotificationType =
    | `motion`
    | `amendment`
    | `assignment`
    | `candidate`
    | `candidate_self`
    | `agenda_added`
    | `agenda_updated`
    | `agenda_removed`;

interface MeetingNotificationState {
    firstSeenAt?: number;
    notifications: MeetingChangeNotification[];
    unreadIds: string[];
    dismissedIds?: string[];
    knownMotionIds?: Id[];
    knownAssignmentIds?: Id[];
    knownAssignmentCandidateIds?: Id[];
    knownAgendaItemIds?: Id[];
    fallbackSeenAt?: Record<string, number>;
}

interface PersistedNotificationState {
    byMeeting: Record<number, MeetingNotificationState>;
}

export interface MeetingChangeNotification {
    id: string;
    meetingId: Id;
    type: MeetingNotificationType;
    title: string;
    subtitle?: string;
    /**
     * Optional machine-readable metadata for later multi-channel delivery
     * (e.g. digest mails) without changing runtime behavior today.
     */
    templateKey?: string;
    templateParams?: Record<string, string | number | boolean>;
    entityType?: `motion` | `assignment` | `assignment_candidate` | `agenda_item` | `topic`;
    entityId?: Id;
    groupKey?: string;
    createdAt: number;
    route: string[];
    queryParams?: Record<string, string | number | boolean | (string | number | boolean)[]>;
}

function isMeetingNotificationState(toCheck: unknown): toCheck is PersistedNotificationState {
    if (!toCheck || typeof toCheck !== `object`) {
        return false;
    }
    const copy = toCheck as PersistedNotificationState;
    return !!copy.byMeeting && typeof copy.byMeeting === `object`;
}

@Injectable({
    providedIn: `root`
})
export class MeetingChangeNotificationService {
    public get notificationsObservable(): BehaviorSubject<MeetingChangeNotification[]> {
        return this._notificationsSubject;
    }

    public get unreadCountObservable(): BehaviorSubject<number> {
        return this._unreadCountSubject;
    }

    public get unreadIdsObservable(): BehaviorSubject<string[]> {
        return this._unreadIdsSubject;
    }

    public get readCountObservable(): BehaviorSubject<number> {
        return this._readCountSubject;
    }

    public get hasActiveMeetingObservable(): BehaviorSubject<boolean> {
        return this._hasActiveMeetingSubject;
    }

    private readonly _notificationsSubject = new BehaviorSubject<MeetingChangeNotification[]>([]);
    private readonly _unreadCountSubject = new BehaviorSubject<number>(0);
    private readonly _unreadIdsSubject = new BehaviorSubject<string[]>([]);
    private readonly _readCountSubject = new BehaviorSubject<number>(0);
    private readonly _hasActiveMeetingSubject = new BehaviorSubject<boolean>(false);
    private readonly byMeeting: Record<number, MeetingNotificationState> = {};
    private readonly meetingDataReady: Record<number, boolean> = {};
    private readonly meetingServerStateLoaded: Record<number, boolean> = {};
    private readonly meetingServerStateHash: Record<number, string> = {};
    private readonly meetingLastSyncedStateHash: Record<number, string> = {};
    private readonly meetingPendingServerSync: Record<number, boolean> = {};
    private readonly stateSubscriptionMeetingUserId: Record<number, Id | null> = {};
    private meetingSubscriptions = new Subscription();
    private activeMeetingId: Id | null = null;
    private syncToServerTimeout: ReturnType<typeof setTimeout> | null = null;
    private syncToServerForce = false;

    public constructor(
        private storage: StorageService,
        private router: Router,
        private activeMeetingIdService: ActiveMeetingIdService,
        private modelRequestService: ModelRequestService,
        private operator: OperatorService,
        private userRepo: UserRepositoryService,
        private meetingUserRepo: MeetingUserRepositoryService,
        private motionRepo: MotionRepositoryService,
        private assignmentRepo: AssignmentRepositoryService,
        private agendaItemRepo: AgendaItemRepositoryService,
        private assignmentCandidateRepo: AssignmentCandidateRepositoryService,
        private historyEntryRepo: HistoryEntryRepositoryService
    ) {
        this.storage.addNoClearKey(STORAGE_KEY);
        void this.setup();
        this.operator.operatorUpdated.subscribe(() => {
            if (this.activeMeetingId) {
                this.rebuildNotificationsFromServer(this.activeMeetingId);
            } else {
                this.updateSubjects();
            }
        });
        this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => {
            this.markNotificationsAsReadByCurrentRoute();
        });
    }

    public markAllAsRead(): void {
        if (!this.activeMeetingId) {
            return;
        }
        const state = this.getMeetingState(this.activeMeetingId);
        if (!state.unreadIds.length) {
            return;
        }
        state.unreadIds = [];
        this.updateSubjects();
        void this.saveToStorage(true);
    }

    public markAsRead(notificationId: string): void {
        if (!this.activeMeetingId) {
            return;
        }
        const state = this.getMeetingState(this.activeMeetingId);
        const nextUnreadIds = state.unreadIds.filter(id => id !== notificationId);
        if (nextUnreadIds.length === state.unreadIds.length) {
            return;
        }
        state.unreadIds = nextUnreadIds;
        this.updateSubjects();
        void this.saveToStorage(true);
    }

    public clearMeetingNotifications(): void {
        if (!this.activeMeetingId) {
            return;
        }
        this.byMeeting[this.activeMeetingId] = {
            firstSeenAt: Date.now(),
            notifications: [],
            unreadIds: [],
            dismissedIds: []
        };
        this.updateSubjects();
        void this.saveToStorage(true);
    }

    public clearReadNotifications(): void {
        if (!this.activeMeetingId) {
            return;
        }
        const state = this.getMeetingState(this.activeMeetingId);
        if (!state.notifications.length) {
            return;
        }
        const unreadIds = new Set(state.unreadIds);
        const removedReadIds = state.notifications
            .filter(notification => !unreadIds.has(notification.id))
            .map(notification => notification.id);
        if (!removedReadIds.length) {
            return;
        }

        const dismissedIds = new Set(state.dismissedIds || []);
        removedReadIds.forEach(id => dismissedIds.add(id));

        state.dismissedIds = Array.from(dismissedIds);
        state.notifications = state.notifications.filter(notification => unreadIds.has(notification.id));
        state.unreadIds = state.unreadIds.filter(id => state.notifications.some(notification => notification.id === id));

        this.updateSubjects();
        void this.saveToStorage(true);
    }

    private async setup(): Promise<void> {
        await this.loadFromStorage();
        this.activeMeetingIdService.meetingIdObservable.subscribe(meetingId => {
            this.activeMeetingId = meetingId;
            this._hasActiveMeetingSubject.next(!!meetingId);
            this.meetingSubscriptions.unsubscribe();
            this.meetingSubscriptions = new Subscription();
            this.closeModelSubscriptions();
            this.updateSubjects();
            if (!meetingId) {
                return;
            }
            this.meetingDataReady[meetingId] = false;
            this.meetingServerStateLoaded[meetingId] = false;
            this.meetingServerStateHash[meetingId] = ``;
            this.meetingLastSyncedStateHash[meetingId] = ``;
            this.meetingPendingServerSync[meetingId] = false;
            this.stateSubscriptionMeetingUserId[meetingId] = null;

            const meetingState = this.getMeetingState(meetingId);
            this.tryLoadMeetingStateFromServer(meetingId);
            if (!meetingState.firstSeenAt) {
                meetingState.firstSeenAt = Date.now();
                void this.saveToStorage();
            }

            void this.startModelSubscriptions(meetingId).then(() => {
                if (this.activeMeetingId === meetingId) {
                    this.meetingDataReady[meetingId] = true;
                    this.rebuildNotificationsFromServer(meetingId);
                }
            });
            this.meetingSubscriptions.add(
                this.historyEntryRepo.getViewModelListObservable().subscribe(() => {
                    if (this.meetingDataReady[meetingId]) {
                        this.rebuildNotificationsFromServer(meetingId);
                    }
                })
            );
            this.meetingSubscriptions.add(
                this.motionRepo.getViewModelListObservable().subscribe(() => {
                    if (this.meetingDataReady[meetingId]) {
                        this.rebuildNotificationsFromServer(meetingId);
                    }
                })
            );
            this.meetingSubscriptions.add(
                this.assignmentCandidateRepo.getViewModelListObservable().subscribe(() => {
                    if (this.meetingDataReady[meetingId]) {
                        this.rebuildNotificationsFromServer(meetingId);
                    }
                })
            );
            this.meetingSubscriptions.add(
                this.agendaItemRepo.getViewModelListObservable().subscribe(() => {
                    if (this.meetingDataReady[meetingId]) {
                        this.rebuildNotificationsFromServer(meetingId);
                    }
                })
            );
            this.meetingSubscriptions.add(
                this.meetingUserRepo.getViewModelListObservable().subscribe(() => {
                    this.ensureStateSubscriptionForMeeting(meetingId);
                    this.tryLoadMeetingStateFromServer(meetingId, true);
                })
            );
            this.meetingSubscriptions.add(
                this.meetingUserRepo.getModifiedIdsObservable().subscribe(modifiedIds => {
                    const operatorId = this.operator.operatorId;
                    if (!operatorId) {
                        return;
                    }
                    const meetingUserId = this.meetingUserRepo.getMeetingUserId(operatorId, meetingId);
                    if (!meetingUserId || !modifiedIds.includes(meetingUserId)) {
                        return;
                    }
                    this.ensureStateSubscriptionForMeeting(meetingId);
                    this.tryLoadMeetingStateFromServer(meetingId, true);
                })
            );
        });
    }

    private tryLoadMeetingStateFromServer(meetingId: Id, force = false): void {
        if (!force && this.meetingServerStateLoaded[meetingId]) {
            return;
        }

        const operatorId = this.operator.operatorId;
        if (!operatorId) {
            return;
        }
        const meetingUserId = this.meetingUserRepo.getMeetingUserId(operatorId, meetingId);
        if (!meetingUserId) {
            return;
        }
        const meetingUser = this.meetingUserRepo.getViewModel(meetingUserId);
        if (!meetingUser) {
            return;
        }

        this.applyRemoteState(meetingId, meetingUser.notification_state, force);
    }

    private applyRemoteState(meetingId: Id, remoteState: any, force: boolean): void {
        const operatorId = this.operator.operatorId;
        const meetingUserId = operatorId ? this.meetingUserRepo.getMeetingUserId(operatorId, meetingId) : null;
        const remoteStateHash = JSON.stringify(remoteState ?? null);
        const remoteStateChanged = this.meetingServerStateHash[meetingId] !== remoteStateHash;
        if (force && !remoteStateChanged) {
            this.meetingServerStateLoaded[meetingId] = true;
            return;
        }
        this.meetingServerStateHash[meetingId] = remoteStateHash;
        this.meetingLastSyncedStateHash[meetingId] = remoteStateHash;

        let stateChanged = false;
        if (remoteState && typeof remoteState === `object`) {
            const state = this.getMeetingState(meetingId);
            const notificationState = remoteState as Partial<MeetingNotificationState>;
            const nextFirstSeenAt = notificationState.firstSeenAt || state.firstSeenAt;
            const nextUnreadIds = Array.isArray(notificationState.unreadIds)
                ? [...notificationState.unreadIds]
                : [...state.unreadIds];
            const nextDismissedIds = Array.isArray(notificationState.dismissedIds)
                ? [...notificationState.dismissedIds]
                : [...(state.dismissedIds || [])];
            const nextKnownMotionIds = Array.isArray(notificationState.knownMotionIds)
                ? [...notificationState.knownMotionIds]
                : [...(state.knownMotionIds || [])];
            const nextKnownAssignmentIds = Array.isArray(notificationState.knownAssignmentIds)
                ? [...notificationState.knownAssignmentIds]
                : [...(state.knownAssignmentIds || [])];
            const nextKnownAssignmentCandidateIds = Array.isArray(notificationState.knownAssignmentCandidateIds)
                ? [...notificationState.knownAssignmentCandidateIds]
                : [...(state.knownAssignmentCandidateIds || [])];
            const nextKnownAgendaItemIds = Array.isArray(notificationState.knownAgendaItemIds)
                ? [...notificationState.knownAgendaItemIds]
                : [...(state.knownAgendaItemIds || [])];
            const nextFallbackSeenAt =
                notificationState.fallbackSeenAt && typeof notificationState.fallbackSeenAt === `object`
                    ? { ...notificationState.fallbackSeenAt }
                    : { ...(state.fallbackSeenAt || {}) };

            stateChanged =
                state.firstSeenAt !== nextFirstSeenAt ||
                !this.sameStringArrays(state.unreadIds, nextUnreadIds) ||
                !this.sameStringArrays(state.dismissedIds || [], nextDismissedIds) ||
                !this.sameIdArrays(state.knownMotionIds || [], nextKnownMotionIds) ||
                !this.sameIdArrays(state.knownAssignmentIds || [], nextKnownAssignmentIds) ||
                !this.sameIdArrays(state.knownAssignmentCandidateIds || [], nextKnownAssignmentCandidateIds) ||
                !this.sameIdArrays(state.knownAgendaItemIds || [], nextKnownAgendaItemIds) ||
                JSON.stringify(state.fallbackSeenAt || {}) !== JSON.stringify(nextFallbackSeenAt);

            state.firstSeenAt = nextFirstSeenAt;
            state.unreadIds = nextUnreadIds;
            state.dismissedIds = nextDismissedIds;
            state.knownMotionIds = nextKnownMotionIds;
            state.knownAssignmentIds = nextKnownAssignmentIds;
            state.knownAssignmentCandidateIds = nextKnownAssignmentCandidateIds;
            state.knownAgendaItemIds = nextKnownAgendaItemIds;
            state.fallbackSeenAt = nextFallbackSeenAt;
        }

        this.meetingServerStateLoaded[meetingId] = true;
        if (this.meetingPendingServerSync[meetingId]) {
            this.meetingPendingServerSync[meetingId] = false;
            void this.syncActiveMeetingStateToServer();
        }
        if (remoteStateChanged && this.meetingDataReady[meetingId]) {
            this.rebuildNotificationsFromServer(meetingId);
        } else if (stateChanged || remoteStateChanged) {
            this.updateSubjects();
        }
    }

    private rebuildNotificationsFromServer(meetingId: Id): void {
        if (this.activeMeetingId !== meetingId) {
            return;
        }

        const state = this.getMeetingState(meetingId);
        const fallbackStateBefore = JSON.stringify({
            knownMotionIds: state.knownMotionIds,
            knownAssignmentIds: state.knownAssignmentIds,
            knownAssignmentCandidateIds: state.knownAssignmentCandidateIds,
            knownAgendaItemIds: state.knownAgendaItemIds,
            fallbackSeenAt: state.fallbackSeenAt
        });
        const previousNotifications = state.notifications;
        const nextNotifications = this.buildNotificationsFromHistory(
            meetingId,
            state,
            state.firstSeenAt || 0,
            new Set(state.dismissedIds || [])
        );
        const fallbackStateAfter = JSON.stringify({
            knownMotionIds: state.knownMotionIds,
            knownAssignmentIds: state.knownAssignmentIds,
            knownAssignmentCandidateIds: state.knownAssignmentCandidateIds,
            knownAgendaItemIds: state.knownAgendaItemIds,
            fallbackSeenAt: state.fallbackSeenAt
        });
        const fallbackStateChanged = fallbackStateBefore !== fallbackStateAfter;

        const previousIds = new Set(previousNotifications.map(notification => notification.id));
        const nextIds = new Set(nextNotifications.map(notification => notification.id));
        const newIds = nextNotifications
            .filter(notification => !previousIds.has(notification.id))
            .map(notification => notification.id);

        const unreadIds: string[] = [];
        const seenUnreadIds = new Set<string>();
        [...newIds, ...state.unreadIds.filter(id => nextIds.has(id))].forEach(id => {
            if (!seenUnreadIds.has(id)) {
                seenUnreadIds.add(id);
                unreadIds.push(id);
            }
        });

        const notificationsChanged = !this.sameNotificationLists(previousNotifications, nextNotifications);
        const unreadChanged = !this.sameStringArrays(state.unreadIds, unreadIds);

        if (!notificationsChanged && !unreadChanged) {
            this.markNotificationsAsReadByCurrentRoute();
            this.updateSubjects();
            if (fallbackStateChanged) {
                void this.saveToStorage();
            }
            return;
        }

        state.notifications = nextNotifications;
        state.unreadIds = unreadIds;

        this.markNotificationsAsReadByCurrentRoute();
        this.updateSubjects();
        void this.saveToStorage();
    }

    private buildNotificationsFromHistory(
        meetingId: Id,
        state: MeetingNotificationState,
        firstSeenAt: number,
        dismissedIds: Set<string>
    ): MeetingChangeNotification[] {
        const historyEntries = this.historyEntryRepo
            .getViewModelList()
            .filter(entry => entry.meeting_id === meetingId)
            .sort((a, b) => (b.position?.timestamp || 0) - (a.position?.timestamp || 0));

        const notifications = historyEntries
            .map(entry => this.createNotificationFromHistoryEntry(meetingId, entry))
            .filter((entry): entry is MeetingChangeNotification => !!entry)
            .filter(notification => notification.createdAt >= firstSeenAt)
            .filter(notification => !dismissedIds.has(notification.id));

        if (notifications.length > 0) {
            return notifications.slice(0, MAX_NOTIFICATIONS_PER_MEETING);
        }

        // Fallback for users without access to history entries.
        const fallbackNotifications = this.buildFallbackNotifications(
            meetingId,
            state,
            firstSeenAt,
            dismissedIds
        );
        return fallbackNotifications.slice(0, MAX_NOTIFICATIONS_PER_MEETING);
    }

    private buildFallbackNotifications(
        meetingId: Id,
        state: MeetingNotificationState,
        firstSeenAt: number,
        dismissedIds: Set<string>
    ): MeetingChangeNotification[] {
        state.knownMotionIds ??= [];
        state.knownAssignmentIds ??= [];
        state.knownAssignmentCandidateIds ??= [];
        state.knownAgendaItemIds ??= [];
        state.fallbackSeenAt ??= {};

        const currentMotionIds = this.motionRepo
            .getViewModelList()
            .filter(motion => motion.meeting_id === meetingId)
            .map(motion => motion.id);
        const currentAssignmentIds = this.assignmentRepo
            .getViewModelList()
            .filter(assignment => assignment.meeting_id === meetingId)
            .map(assignment => assignment.id);
        const currentCandidateIds = this.assignmentCandidateRepo
            .getViewModelList()
            .filter(candidate => candidate.meeting_id === meetingId)
            .map(candidate => candidate.id);
        const currentAgendaIds = this.agendaItemRepo
            .getViewModelList()
            .filter(item => item.meeting_id === meetingId)
            .map(item => item.id);

        const hasBaseline =
            state.knownMotionIds.length > 0 ||
            state.knownAssignmentIds.length > 0 ||
            state.knownAssignmentCandidateIds.length > 0 ||
            state.knownAgendaItemIds.length > 0;
        if (!hasBaseline) {
            state.knownMotionIds = [...new Set(currentMotionIds)];
            state.knownAssignmentIds = [...new Set(currentAssignmentIds)];
            state.knownAssignmentCandidateIds = [...new Set(currentCandidateIds)];
            state.knownAgendaItemIds = [...new Set(currentAgendaIds)];
            return [];
        }

        this.captureNewFallbackEntitySeenAt(
            `motion`,
            currentMotionIds,
            state.knownMotionIds,
            state.fallbackSeenAt
        );
        this.captureNewFallbackEntitySeenAt(
            `assignment`,
            currentAssignmentIds,
            state.knownAssignmentIds,
            state.fallbackSeenAt
        );
        this.captureNewFallbackEntitySeenAt(
            `assignment_candidate`,
            currentCandidateIds,
            state.knownAssignmentCandidateIds,
            state.fallbackSeenAt
        );
        this.captureNewFallbackEntitySeenAt(
            `agenda_item`,
            currentAgendaIds,
            state.knownAgendaItemIds,
            state.fallbackSeenAt
        );

        const motionNotifications = this.canSeeMotions()
            ? this.motionRepo
                  .getViewModelList()
                  .filter(motion => motion.meeting_id === meetingId)
                  .map(motion =>
                      this.createFallbackMotionNotification(meetingId, motion, state.fallbackSeenAt || {})
                  )
                  .filter((notification): notification is MeetingChangeNotification => !!notification)
            : [];

        const candidateNotifications = this.canSeeAssignments()
            ? this.assignmentCandidateRepo
                  .getViewModelList()
                  .filter(candidate => candidate.meeting_id === meetingId)
                  .map(candidate =>
                      this.createFallbackCandidateNotification(meetingId, candidate.id, state.fallbackSeenAt || {})
                  )
                  .filter((notification): notification is MeetingChangeNotification => !!notification)
            : [];
        const assignmentNotifications = this.canSeeAssignments()
            ? this.assignmentRepo
                  .getViewModelList()
                  .filter(assignment => assignment.meeting_id === meetingId)
                  .map(assignment =>
                      this.createFallbackAssignmentNotification(meetingId, assignment.id, state.fallbackSeenAt || {})
                  )
                  .filter((notification): notification is MeetingChangeNotification => !!notification)
            : [];

        const agendaNotifications = this.canSeeAgenda()
            ? this.agendaItemRepo
                  .getViewModelList()
                  .filter(item => item.meeting_id === meetingId)
                  .map(item =>
                      this.createFallbackAgendaAddedNotification(meetingId, item.id, state.fallbackSeenAt || {})
                  )
                  .filter((notification): notification is MeetingChangeNotification => !!notification)
            : [];

        return [...motionNotifications, ...assignmentNotifications, ...candidateNotifications, ...agendaNotifications]
            .filter(notification => notification.createdAt >= firstSeenAt)
            .filter(notification => !dismissedIds.has(notification.id))
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    private captureNewFallbackEntitySeenAt(
        entityType: `motion` | `assignment` | `assignment_candidate` | `agenda_item`,
        currentIds: Id[],
        knownIds: Id[],
        fallbackSeenAt: Record<string, number>
    ): void {
        const known = new Set(knownIds);
        currentIds.forEach(id => {
            if (!known.has(id)) {
                known.add(id);
                fallbackSeenAt[`${entityType}:${id}`] = Date.now();
            }
        });
        knownIds.length = 0;
        known.forEach(id => knownIds.push(id));
    }

    private createFallbackMotionNotification(
        meetingId: Id,
        motion: ViewMotion,
        fallbackSeenAt: Record<string, number>
    ): MeetingChangeNotification | undefined {
        const createdAt = fallbackSeenAt[`motion:${motion.id}`] || 0;
        if (!createdAt || this.isOwnMotionBySubmitter(motion)) {
            return undefined;
        }

        const isAmendment = !!motion.lead_motion_id;
        return {
            id: this.getMotionNotificationId(motion.id),
            meetingId,
            createdAt,
            type: isAmendment ? `amendment` : `motion`,
            title: motion.title || motion.number || `#${motion.sequential_number || motion.id}`,
            subtitle: isAmendment ? `Motions / Amendments` : `Motions`,
            route: motion.sequential_number
                ? [`/`, `${meetingId}`, `motions`, `${motion.sequential_number}`]
                : [`/`, `${meetingId}`, `motions`],
            templateKey: isAmendment ? `notification.motion.amendment_created` : `notification.motion.created`,
            templateParams: { motionId: motion.id },
            entityType: `motion`,
            entityId: motion.id,
            groupKey: `motion:${motion.id}`
        };
    }

    private createFallbackCandidateNotification(
        meetingId: Id,
        candidateId: Id,
        fallbackSeenAt: Record<string, number>
    ): MeetingChangeNotification | undefined {
        const createdAt = fallbackSeenAt[`assignment_candidate:${candidateId}`] || 0;
        if (!createdAt) {
            return undefined;
        }
        return this.createCandidateNotification(meetingId, candidateId, candidateId, createdAt);
    }

    private createFallbackAssignmentNotification(
        meetingId: Id,
        assignmentId: Id,
        fallbackSeenAt: Record<string, number>
    ): MeetingChangeNotification | undefined {
        const createdAt = fallbackSeenAt[`assignment:${assignmentId}`] || 0;
        if (!createdAt) {
            return undefined;
        }
        const assignment = this.assignmentRepo.getViewModel(assignmentId);
        if (!assignment) {
            return undefined;
        }

        return {
            id: this.getAssignmentNotificationId(assignmentId),
            meetingId,
            createdAt,
            type: `assignment`,
            title: assignment.title || `Election`,
            subtitle: `Elections`,
            route: assignment.sequential_number
                ? [`/`, `${meetingId}`, `assignments`, `${assignment.sequential_number}`]
                : [`/`, `${meetingId}`, `assignments`],
            templateKey: `notification.assignment.created`,
            templateParams: { assignmentId },
            entityType: `assignment`,
            entityId: assignmentId,
            groupKey: `assignment:${assignmentId}`
        };
    }

    private createFallbackAgendaAddedNotification(
        meetingId: Id,
        agendaItemId: Id,
        fallbackSeenAt: Record<string, number>
    ): MeetingChangeNotification | undefined {
        const createdAt = fallbackSeenAt[`agenda_item:${agendaItemId}`] || 0;
        if (!createdAt) {
            return undefined;
        }
        return this.createAgendaNotification(meetingId, agendaItemId, `agenda_added`, agendaItemId, createdAt);
    }

    private isOwnMotionBySubmitter(motion: ViewMotion): boolean {
        const operatorId = this.operator.operatorId;
        if (!operatorId || !motion.submitters?.length) {
            return false;
        }

        return motion.submitters.some(
            submitter =>
                submitter.meeting_user?.user_id === operatorId || submitter.meeting_user?.user?.id === operatorId
        );
    }

    private createNotificationFromHistoryEntry(
        meetingId: Id,
        historyEntry: ViewHistoryEntry
    ): MeetingChangeNotification | undefined {
        const createdAt = (historyEntry.position?.timestamp || 0) * 1000;
        if (!createdAt) {
            return undefined;
        }

        const entryTitle = historyEntry.entries?.[0] || ``;
        const modelFqid = historyEntry.model_id || historyEntry.original_model_id;
        const modelFqidParts = modelFqid?.split(`/`) || [];
        const modelCollection = modelFqidParts[0] || ``;
        const modelId = Number(modelFqidParts[1]);
        if (!modelCollection || !modelId) {
            return undefined;
        }

        const actorUserId = historyEntry.position?.original_user_id;

        switch (entryTitle) {
            case HISTORY_ENTRY_MOTION_CREATED:
                if (modelCollection !== `motion`) {
                    return undefined;
                }
                return this.createMotionNotification(meetingId, historyEntry.id, modelId, createdAt, actorUserId);
            case HISTORY_ENTRY_CANDIDATE_ADDED:
                if (modelCollection !== `assignment_candidate`) {
                    return undefined;
                }
                return this.createCandidateNotification(meetingId, historyEntry.id, modelId, createdAt, actorUserId);
            case HISTORY_ENTRY_AGENDA_ADDED:
                if (modelCollection !== `agenda_item`) {
                    return undefined;
                }
                return this.createAgendaNotification(
                    meetingId,
                    historyEntry.id,
                    `agenda_added`,
                    modelId,
                    createdAt,
                    actorUserId
                );
            case HISTORY_ENTRY_AGENDA_UPDATED:
                if (modelCollection !== `agenda_item`) {
                    return undefined;
                }
                return this.createAgendaNotification(
                    meetingId,
                    historyEntry.id,
                    `agenda_updated`,
                    modelId,
                    createdAt,
                    actorUserId
                );
            case HISTORY_ENTRY_AGENDA_REMOVED:
                if (modelCollection !== `agenda_item`) {
                    return undefined;
                }
                return this.createAgendaNotification(
                    meetingId,
                    historyEntry.id,
                    `agenda_removed`,
                    modelId,
                    createdAt,
                    actorUserId
                );
            default:
                return undefined;
        }
    }

    private createMotionNotification(
        meetingId: Id,
        historyEntryId: Id,
        motionId: Id,
        createdAt: number,
        actorUserId?: number
    ): MeetingChangeNotification | undefined {
        if (!this.canSeeMotions() || this.isOwnActor(actorUserId)) {
            return undefined;
        }

        const motion = this.motionRepo.getViewModel(motionId);
        const isAmendment = !!motion?.lead_motion_id;

        return {
            id: this.getMotionNotificationId(motionId),
            meetingId,
            createdAt,
            type: isAmendment ? `amendment` : `motion`,
            title: motion?.title || motion?.number || `#${motion?.sequential_number || motionId}`,
            subtitle: isAmendment ? `Motions / Amendments` : `Motions`,
            route: motion?.sequential_number
                ? [`/`, `${meetingId}`, `motions`, `${motion.sequential_number}`]
                : [`/`, `${meetingId}`, `motions`],
            templateKey: isAmendment ? `notification.motion.amendment_created` : `notification.motion.created`,
            templateParams: { motionId },
            entityType: `motion`,
            entityId: motionId,
            groupKey: `motion:${motionId}`
        };
    }

    private createCandidateNotification(
        meetingId: Id,
        historyEntryId: Id,
        candidateId: Id,
        createdAt: number,
        actorUserId?: number
    ): MeetingChangeNotification | undefined {
        if (!this.canSeeAssignments()) {
            return undefined;
        }

        const candidate = this.assignmentCandidateRepo.getViewModel(candidateId);
        if (!candidate || this.isOwnActor(actorUserId)) {
            return undefined;
        }

        const operatorId = this.operator.operatorId;
        const assignmentNumber = candidate.assignment?.sequential_number;
        const isSelfCandidate = !!operatorId && candidate.user_id === operatorId;

        return {
            id: this.getCandidateNotificationId(candidateId),
            meetingId,
            createdAt,
            type: isSelfCandidate ? `candidate_self` : `candidate`,
            title: isSelfCandidate ? `You were added as candidate` : candidate.user?.short_name || `New candidate`,
            subtitle: candidate.assignment?.title,
            route: assignmentNumber
                ? [`/`, `${meetingId}`, `assignments`, `${assignmentNumber}`]
                : [`/`, `${meetingId}`, `assignments`],
            templateKey: isSelfCandidate
                ? `notification.assignment.candidate_self_added`
                : `notification.assignment.candidate_added`,
            templateParams: { assignmentId: candidate.assignment_id },
            entityType: `assignment_candidate`,
            entityId: candidate.id,
            groupKey: `assignment_candidate:${candidate.id}`
        };
    }

    private createAgendaNotification(
        meetingId: Id,
        historyEntryId: Id,
        type: `agenda_added` | `agenda_updated` | `agenda_removed`,
        agendaItemId: Id,
        createdAt: number,
        actorUserId?: number
    ): MeetingChangeNotification | undefined {
        if (!this.canSeeAgenda() || this.isOwnActor(actorUserId)) {
            return undefined;
        }

        const agendaItem = this.agendaItemRepo.getViewModel(agendaItemId);
        if (type === `agenda_added` && agendaItem?.content_object_id?.startsWith(`motion/`)) {
            return undefined;
        }

        const { route, queryParams } = this.getAgendaNotificationTarget(meetingId, agendaItemId, agendaItem);

        return {
            id: this.getAgendaNotificationId(type, agendaItemId),
            meetingId,
            createdAt,
            type,
            title: agendaItem ? this.agendaItemRepo.getTitle(agendaItem) : `Agenda item`,
            route,
            queryParams,
            templateKey:
                type === `agenda_added`
                    ? `notification.agenda.item_added`
                    : type === `agenda_updated`
                      ? `notification.agenda.item_updated`
                      : `notification.agenda.item_removed`,
            templateParams: { agendaItemId },
            entityType: agendaItem?.content_object_id?.startsWith(`topic/`) ? `topic` : `agenda_item`,
            entityId: agendaItemId,
            groupKey: `agenda_item:${agendaItemId}`
        };
    }

    private getAgendaNotificationTarget(
        meetingId: Id,
        agendaItemId: Id,
        agendaItem?: ViewAgendaItem
    ): Pick<MeetingChangeNotification, `route` | `queryParams`> {
        const topicPrefix = `topic/`;
        if (agendaItem?.content_object_id?.startsWith(topicPrefix)) {
            const topicId = agendaItem.content_object_id.slice(topicPrefix.length);
            if (topicId) {
                return {
                    route: [`/`, `${meetingId}`, `agenda`, `topics`, topicId]
                };
            }
        }

        return {
            route: [`/`, `${meetingId}`, `agenda`],
            queryParams: { 'agenda-items': agendaItemId }
        };
    }

    private isOwnActor(actorUserId?: number): boolean {
        const operatorId = this.operator.operatorId;
        if (!operatorId || !actorUserId || actorUserId <= 0) {
            return false;
        }
        return operatorId === actorUserId;
    }

    private getMotionNotificationId(motionId: Id): string {
        return `motion-${motionId}`;
    }

    private getCandidateNotificationId(candidateId: Id): string {
        return `assignment-candidate-${candidateId}`;
    }

    private getAssignmentNotificationId(assignmentId: Id): string {
        return `assignment-${assignmentId}`;
    }

    private getAgendaNotificationId(type: `agenda_added` | `agenda_updated` | `agenda_removed`, agendaItemId: Id): string {
        return `agenda-${type}-${agendaItemId}`;
    }

    private getMeetingState(meetingId: Id): MeetingNotificationState {
        if (!this.byMeeting[meetingId]) {
            this.byMeeting[meetingId] = {
                notifications: [],
                unreadIds: [],
                dismissedIds: [],
                knownMotionIds: [],
                knownAssignmentIds: [],
                knownAssignmentCandidateIds: [],
                knownAgendaItemIds: [],
                fallbackSeenAt: {}
            };
        }
        if (!this.byMeeting[meetingId].dismissedIds) {
            this.byMeeting[meetingId].dismissedIds = [];
        }
        this.byMeeting[meetingId].knownMotionIds ??= [];
        this.byMeeting[meetingId].knownAssignmentIds ??= [];
        this.byMeeting[meetingId].knownAssignmentCandidateIds ??= [];
        this.byMeeting[meetingId].knownAgendaItemIds ??= [];
        this.byMeeting[meetingId].fallbackSeenAt ??= {};
        return this.byMeeting[meetingId];
    }

    private updateSubjects(): void {
        if (!this.activeMeetingId) {
            this._notificationsSubject.next([]);
            this._unreadCountSubject.next(0);
            this._unreadIdsSubject.next([]);
            this._readCountSubject.next(0);
            return;
        }
        const state = this.getMeetingState(this.activeMeetingId);
        const visibleNotifications = state.notifications.filter(notification => this.canSeeNotificationType(notification.type));
        const visibleIds = new Set(visibleNotifications.map(notification => notification.id));
        const visibleUnreadIds = state.unreadIds.filter(id => visibleIds.has(id));
        this._notificationsSubject.next(visibleNotifications);
        this._unreadCountSubject.next(visibleUnreadIds.length);
        this._unreadIdsSubject.next(visibleUnreadIds);
        this._readCountSubject.next(visibleNotifications.length - visibleUnreadIds.length);
    }

    private async loadFromStorage(): Promise<void> {
        const state = await this.storage.get<PersistedNotificationState>(STORAGE_KEY);
        if (!isMeetingNotificationState(state)) {
            return;
        }
        Object.entries(state.byMeeting).forEach(([meetingIdAsString, meetingState]) => {
            const meetingId = Number(meetingIdAsString);
            if (!meetingId || !meetingState) {
                return;
            }
            const notifications = (meetingState.notifications || []).map(notification => ({
                ...notification,
                meetingId
            }));
            const unreadIds = (meetingState.unreadIds || []).filter(unreadId =>
                notifications.some(notification => notification.id === unreadId)
            );
            const dismissedIds = (meetingState.dismissedIds || []).filter(dismissedId =>
                notifications.some(notification => notification.id === dismissedId)
            );
            this.byMeeting[meetingId] = {
                firstSeenAt: meetingState.firstSeenAt,
                notifications,
                unreadIds,
                dismissedIds,
                knownMotionIds: [...(meetingState.knownMotionIds || [])],
                knownAssignmentIds: [...(meetingState.knownAssignmentIds || [])],
                knownAssignmentCandidateIds: [...(meetingState.knownAssignmentCandidateIds || [])],
                knownAgendaItemIds: [...(meetingState.knownAgendaItemIds || [])],
                fallbackSeenAt: { ...(meetingState.fallbackSeenAt || {}) }
            };
        });
    }

    private async saveToStorage(forceServerSync = false): Promise<void> {
        await this.storage.set(STORAGE_KEY, { byMeeting: this.byMeeting });
        this.scheduleServerSync(forceServerSync);
    }

    private scheduleServerSync(forceServerSync = false): void {
        if (this.syncToServerTimeout) {
            clearTimeout(this.syncToServerTimeout);
        }
        this.syncToServerForce = this.syncToServerForce || forceServerSync;
        this.syncToServerTimeout = setTimeout(() => {
            const forceSync = this.syncToServerForce;
            this.syncToServerForce = false;
            void this.syncActiveMeetingStateToServer(forceSync);
        }, 200);
    }

    private async syncActiveMeetingStateToServer(forceSync = false): Promise<void> {
        const meetingId = this.activeMeetingId;
        if (!meetingId || !this.operator.isAuthenticated) {
            return;
        }
        if (!this.meetingServerStateLoaded[meetingId] && !forceSync) {
            this.meetingPendingServerSync[meetingId] = true;
            return;
        }

        const state = this.getMeetingState(meetingId);
        const payload = {
            firstSeenAt: state.firstSeenAt,
            unreadIds: state.unreadIds,
            dismissedIds: state.dismissedIds || [],
            knownMotionIds: state.knownMotionIds || [],
            knownAssignmentIds: state.knownAssignmentIds || [],
            knownAssignmentCandidateIds: state.knownAssignmentCandidateIds || [],
            knownAgendaItemIds: state.knownAgendaItemIds || [],
            fallbackSeenAt: state.fallbackSeenAt || {}
        };
        const payloadHash = JSON.stringify(payload);
        if (
            payloadHash === this.meetingServerStateHash[meetingId] ||
            payloadHash === this.meetingLastSyncedStateHash[meetingId]
        ) {
            return;
        }

        try {
            await this.userRepo.updateSelf(
                {
                    meeting_id: meetingId,
                    notification_state: payload
                } as any,
                this.operator.user
            );
            this.meetingLastSyncedStateHash[meetingId] = payloadHash;
        } catch (e) {
            // keep local state as fallback if server sync fails temporarily
            return;
        }
    }

    private async startModelSubscriptions(meetingId: Id): Promise<void> {
        const motionConfig = {
            ...getMotionListSubscriptionConfig(meetingId),
            subscriptionName: NOTIFICATION_MOTION_SUBSCRIPTION
        };
        const assignmentConfig = {
            modelRequest: {
                viewModelCtor: ViewMeeting,
                ids: [meetingId],
                follow: [
                    {
                        idField: `assignment_ids`,
                        fieldset: [`id`, `meeting_id`, `sequential_number`, `title`, `candidate_ids`],
                        follow: [
                            {
                                idField: `candidate_ids`,
                                fieldset: [`id`, `meeting_id`, `assignment_id`, `meeting_user_id`, `weight`],
                                follow: [{ idField: `meeting_user_id`, ...MeetingUserFieldsets.FullNameSubscription }]
                            }
                        ]
                    }
                ]
            },
            subscriptionName: NOTIFICATION_ASSIGNMENT_SUBSCRIPTION
        };
        const agendaConfig = {
            ...getAgendaListMinimalSubscriptionConfig(meetingId),
            subscriptionName: NOTIFICATION_AGENDA_SUBSCRIPTION
        };
        const historyConfig = {
            modelRequest: {
                viewModelCtor: ViewMeeting,
                ids: [meetingId],
                follow: [
                    {
                        idField: `relevant_history_entry_ids`,
                        fieldset: [`id`, `entries`, `meeting_id`, `model_id`, `original_model_id`, `position_id`],
                        follow: [
                            {
                                idField: `position_id`,
                                fieldset: [`id`, `timestamp`, `original_user_id`]
                            }
                        ]
                    }
                ]
            },
            subscriptionName: NOTIFICATION_HISTORY_SUBSCRIPTION
        };
        const stateConfig = this.getStateSubscriptionConfig(meetingId);

        const subscribeCalls = [
            this.modelRequestService.subscribeTo(motionConfig),
            this.modelRequestService.subscribeTo(assignmentConfig),
            this.modelRequestService.subscribeTo(agendaConfig),
            this.modelRequestService.subscribeTo(historyConfig)
        ];
        subscribeCalls.push(this.modelRequestService.subscribeTo(stateConfig));
        await Promise.allSettled(subscribeCalls);

        const readyCalls = [
            this.modelRequestService.waitSubscriptionReady(NOTIFICATION_MOTION_SUBSCRIPTION, 6000),
            this.modelRequestService.waitSubscriptionReady(NOTIFICATION_ASSIGNMENT_SUBSCRIPTION, 6000),
            this.modelRequestService.waitSubscriptionReady(NOTIFICATION_AGENDA_SUBSCRIPTION, 6000),
            this.modelRequestService.waitSubscriptionReady(NOTIFICATION_HISTORY_SUBSCRIPTION, 6000)
        ];
        readyCalls.push(this.modelRequestService.waitSubscriptionReady(NOTIFICATION_STATE_SUBSCRIPTION, 6000));
        await Promise.allSettled(readyCalls);
        this.stateSubscriptionMeetingUserId[meetingId] = this.getCurrentMeetingUserId(meetingId);
    }

    private closeModelSubscriptions(): void {
        this.modelRequestService.closeSubscription(NOTIFICATION_MOTION_SUBSCRIPTION);
        this.modelRequestService.closeSubscription(NOTIFICATION_ASSIGNMENT_SUBSCRIPTION);
        this.modelRequestService.closeSubscription(NOTIFICATION_AGENDA_SUBSCRIPTION);
        this.modelRequestService.closeSubscription(NOTIFICATION_HISTORY_SUBSCRIPTION);
        this.modelRequestService.closeSubscription(NOTIFICATION_STATE_SUBSCRIPTION);
    }

    public async refreshStateFromServerNow(): Promise<void> {
        if (!this.activeMeetingId) {
            return;
        }
        await this.refreshStateFromServer(this.activeMeetingId);
    }

    private async refreshStateFromServer(meetingId: Id): Promise<void> {
        if (this.activeMeetingId !== meetingId || !this.operator.isAuthenticated) {
            return;
        }
        this.ensureStateSubscriptionForMeeting(meetingId);
        const stateConfig = this.getStateSubscriptionConfig(meetingId);

        try {
            const fetchedModelData = await this.modelRequestService.fetch(
                {
                    modelRequest: {
                        ...stateConfig.modelRequest
                    },
                    subscriptionName: `${NOTIFICATION_STATE_SUBSCRIPTION}-manual-refresh`
                },
                50
            );
            const remoteState = this.getNotificationStateFromFetchedModelData(meetingId, fetchedModelData);
            if (remoteState !== undefined) {
                this.applyRemoteState(meetingId, remoteState, true);
                return;
            }
        } catch (e) {
            // Fallback to state subscription refresh.
        }

        try {
            await this.modelRequestService.updateSubscribeTo(stateConfig);
            await this.modelRequestService.waitSubscriptionReady(NOTIFICATION_STATE_SUBSCRIPTION, 3000);
        } catch (e) {
            // Keep last known client state.
        }

        this.tryLoadMeetingStateFromServer(meetingId, true);
    }

    private getNotificationStateFromFetchedModelData(meetingId: Id, modelData: ModelData): any | undefined {
        const operatorId = this.operator.operatorId;
        if (!operatorId || !modelData[`meeting_user`]) {
            return undefined;
        }

        const meetingUsers = modelData[`meeting_user`] as Record<number, Record<string, any>>;
        const meetingUserId = this.meetingUserRepo.getMeetingUserId(operatorId, meetingId);
        if (
            meetingUserId &&
            meetingUsers[meetingUserId] &&
            Object.prototype.hasOwnProperty.call(meetingUsers[meetingUserId], `notification_state`)
        ) {
            return meetingUsers[meetingUserId][`notification_state`];
        }

        for (const partialMeetingUser of Object.values(meetingUsers)) {
            if (
                partialMeetingUser[`user_id`] === operatorId &&
                partialMeetingUser[`meeting_id`] === meetingId &&
                Object.prototype.hasOwnProperty.call(partialMeetingUser, `notification_state`)
            ) {
                return partialMeetingUser[`notification_state`];
            }
        }

        return undefined;
    }

    private getStateSubscriptionConfig(meetingId: Id): {
        modelRequest: any;
        subscriptionName: string;
    } {
        const meetingUserId = this.getCurrentMeetingUserId(meetingId);
        if (meetingUserId) {
            return {
                modelRequest: {
                    viewModelCtor: ViewMeetingUser,
                    ids: [meetingUserId],
                    fieldset: [`id`, `meeting_id`, `user_id`, `notification_state`]
                },
                subscriptionName: NOTIFICATION_STATE_SUBSCRIPTION
            };
        }

        return {
            modelRequest: {
                viewModelCtor: ViewMeeting,
                ids: [meetingId],
                follow: [
                    {
                        idField: `meeting_user_ids`,
                        fieldset: [`id`, `meeting_id`, `user_id`, `notification_state`]
                    }
                ]
            },
            subscriptionName: NOTIFICATION_STATE_SUBSCRIPTION
        };
    }

    private getCurrentMeetingUserId(meetingId: Id): Id | null {
        const operatorId = this.operator.operatorId;
        if (!operatorId) {
            return null;
        }
        return this.meetingUserRepo.getMeetingUserId(operatorId, meetingId);
    }

    private ensureStateSubscriptionForMeeting(meetingId: Id): void {
        const meetingUserId = this.getCurrentMeetingUserId(meetingId);
        if (!meetingUserId || this.stateSubscriptionMeetingUserId[meetingId] === meetingUserId) {
            return;
        }
        this.stateSubscriptionMeetingUserId[meetingId] = meetingUserId;
        void this.modelRequestService.updateSubscribeTo(this.getStateSubscriptionConfig(meetingId));
    }

    private canSeeMotions(): boolean {
        return this.operator.hasPerms(
            Permission.motionCanSee,
            Permission.motionCanSeeInternal,
            Permission.motionCanCreate,
            Permission.motionCanCreateAmendments,
            Permission.motionCanSupport
        );
    }

    private canSeeAssignments(): boolean {
        return this.operator.hasPerms(
            Permission.assignmentCanSee,
            Permission.assignmentCanNominateSelf,
            Permission.assignmentCanNominateOther
        );
    }

    private canSeeAgenda(): boolean {
        return this.operator.hasPerms(Permission.agendaItemCanSee, Permission.agendaItemCanSeeInternal);
    }

    private canSeeNotificationType(type: MeetingNotificationType): boolean {
        switch (type) {
            case `motion`:
            case `amendment`:
                return this.canSeeMotions();
            case `assignment`:
            case `candidate`:
            case `candidate_self`:
                return this.canSeeAssignments();
            case `agenda_added`:
            case `agenda_updated`:
            case `agenda_removed`:
                return this.canSeeAgenda();
        }
    }

    private markNotificationsAsReadByCurrentRoute(): void {
        if (!this.activeMeetingId) {
            return;
        }
        const state = this.getMeetingState(this.activeMeetingId);
        if (!state.unreadIds.length) {
            return;
        }

        const urlTree = this.router.parseUrl(this.router.url);
        const primary = urlTree.root.children[`primary`];
        if (!primary?.segments?.length) {
            return;
        }

        const segments = primary.segments.map(segment => segment.path);
        const meetingIdFromRoute = Number(segments[0]);
        if (!meetingIdFromRoute || meetingIdFromRoute !== this.activeMeetingId) {
            return;
        }

        const nextUnread = state.unreadIds.filter(unreadId => {
            const notification = state.notifications.find(entry => entry.id === unreadId);
            return notification ? !this.isVisitedByCurrentRoute(notification, segments, urlTree) : false;
        });

        if (nextUnread.length === state.unreadIds.length) {
            return;
        }

        state.unreadIds = nextUnread;
        this.updateSubjects();
        void this.saveToStorage(true);
    }

    private isVisitedByCurrentRoute(
        notification: MeetingChangeNotification,
        routeSegments: string[],
        urlTree: UrlTree
    ): boolean {
        const section = routeSegments[1] ?? ``;
        const detailSegment = routeSegments[2] ?? ``;
        const currentPath = `/${routeSegments.join(`/`)}`;
        const notificationRouteSegments = notification.route
            .filter(segment => !!segment && segment !== `/`)
            .map(segment => `${segment}`);
        const notificationDetailSegment = notificationRouteSegments[2] ?? ``;
        const notificationPath = `/${notificationRouteSegments.join(`/`)}`;

        switch (notification.type) {
            case `motion`:
            case `amendment`:
                return (
                    section === `motions` &&
                    !!detailSegment &&
                    !!notificationDetailSegment &&
                    (currentPath === notificationPath || currentPath.startsWith(`${notificationPath}/`))
                );
            case `assignment`:
            case `candidate`:
            case `candidate_self`:
                return (
                    section === `assignments` &&
                    !!detailSegment &&
                    !!notificationDetailSegment &&
                    (currentPath === notificationPath || currentPath.startsWith(`${notificationPath}/`))
                );
            case `agenda_added`:
            case `agenda_updated`:
                if (section !== `agenda`) {
                    return false;
                }
                if (
                    !!notificationDetailSegment &&
                    (currentPath === notificationPath || currentPath.startsWith(`${notificationPath}/`))
                ) {
                    return true;
                }
                // Backward-compatibility for older notifications with list query params.
                if (urlTree.queryParamMap.getAll(`agenda-items`).includes(`${notification.queryParams?.[`agenda-items`]}`)) {
                    return true;
                }
                return false;
            case `agenda_removed`:
                return false;
        }
    }

    private sameStringArrays(left: string[], right: string[]): boolean {
        if (left.length !== right.length) {
            return false;
        }
        return left.every((value, index) => value === right[index]);
    }

    private sameIdArrays(left: Id[], right: Id[]): boolean {
        if (left.length !== right.length) {
            return false;
        }
        return left.every((value, index) => value === right[index]);
    }

    private sameNotificationLists(
        left: MeetingChangeNotification[],
        right: MeetingChangeNotification[]
    ): boolean {
        if (left.length !== right.length) {
            return false;
        }
        return left.every((entry, index) => {
            const other = right[index];
            return (
                entry.id === other.id &&
                entry.type === other.type &&
                entry.title === other.title &&
                entry.subtitle === other.subtitle &&
                entry.createdAt === other.createdAt
            );
        });
    }
}
