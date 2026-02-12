import { Injectable } from '@angular/core';
import { NavigationEnd, Router, UrlTree } from '@angular/router';
import { BehaviorSubject, filter, Subscription } from 'rxjs';
import { Id } from 'src/app/domain/definitions/key-types';
import { Permission } from 'src/app/domain/definitions/permission';
import { AgendaItemRepositoryService } from 'src/app/gateways/repositories/agenda';
import { AssignmentCandidateRepositoryService } from 'src/app/gateways/repositories/assignments/assignment-candidate-repository.service/assignment-candidate-repository.service';
import { MotionRepositoryService } from 'src/app/gateways/repositories/motions/motion-repository.service/motion-repository.service';
import { StorageService } from 'src/app/gateways/storage.service';
import { MeetingUserFieldsets } from 'src/app/domain/fieldsets/user';
import { getAgendaListMinimalSubscriptionConfig } from 'src/app/site/pages/meetings/pages/agenda/agenda.subscription';
import { ViewAgendaItem } from 'src/app/site/pages/meetings/pages/agenda';
import { ViewAssignmentCandidate } from 'src/app/site/pages/meetings/pages/assignments';
import { getMotionListSubscriptionConfig } from 'src/app/site/pages/meetings/pages/motions/motions.subscription';
import { ViewMotion } from 'src/app/site/pages/meetings/pages/motions';
import { OperatorService } from 'src/app/site/services/operator.service';
import { ModelRequestService } from 'src/app/site/services/model-request.service';
import { ViewMeeting } from 'src/app/site/pages/meetings/view-models/view-meeting';

import { ActiveMeetingIdService } from './active-meeting-id.service';

const STORAGE_KEY = `os4-meeting-change-notifications`;
const MAX_NOTIFICATIONS_PER_MEETING = 100;
const NOTIFICATION_MOTION_SUBSCRIPTION = `meeting-notifications-motion-list`;
const NOTIFICATION_ASSIGNMENT_SUBSCRIPTION = `meeting-notifications-assignment-list`;
const NOTIFICATION_AGENDA_SUBSCRIPTION = `meeting-notifications-agenda-list`;

export type MeetingNotificationType =
    | `motion`
    | `amendment`
    | `candidate`
    | `candidate_self`
    | `agenda_added`
    | `agenda_updated`
    | `agenda_removed`;

interface AgendaSnapshotEntry {
    contentSignature: string;
    orderSignature: string;
    title: string;
    contentObjectId?: string;
}

interface MeetingNotificationState {
    firstSeenAt?: number;
    notifications: MeetingChangeNotification[];
    unreadIds: string[];
}

interface PersistedNotificationState {
    byMeeting: Record<number, MeetingNotificationState>;
}

interface MeetingWatchState {
    isBootstrapping: boolean;
    motionsInitialized: boolean;
    knownMotionIds: Set<Id>;
    candidatesInitialized: boolean;
    knownCandidateIds: Set<Id>;
    agendaInitialized: boolean;
    agendaSnapshots: Map<Id, AgendaSnapshotEntry>;
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
    entityType?: `motion` | `assignment_candidate` | `agenda_item` | `topic`;
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
    private readonly watchState: MeetingWatchState = {
        isBootstrapping: false,
        motionsInitialized: false,
        knownMotionIds: new Set<Id>(),
        candidatesInitialized: false,
        knownCandidateIds: new Set<Id>(),
        agendaInitialized: false,
        agendaSnapshots: new Map<Id, AgendaSnapshotEntry>()
    };
    private meetingSubscriptions = new Subscription();
    private activeMeetingId: Id | null = null;

    public constructor(
        private storage: StorageService,
        private router: Router,
        private activeMeetingIdService: ActiveMeetingIdService,
        private modelRequestService: ModelRequestService,
        private operator: OperatorService,
        private motionRepo: MotionRepositoryService,
        private agendaItemRepo: AgendaItemRepositoryService,
        private assignmentCandidateRepo: AssignmentCandidateRepositoryService
    ) {
        this.storage.addNoClearKey(STORAGE_KEY);
        void this.setup();
        this.operator.operatorUpdated.subscribe(() => {
            this.updateSubjects();
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
        void this.saveToStorage();
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
        void this.saveToStorage();
    }

    public clearMeetingNotifications(): void {
        if (!this.activeMeetingId) {
            return;
        }
        const previousFirstSeenAt = this.getMeetingState(this.activeMeetingId).firstSeenAt;
        this.byMeeting[this.activeMeetingId] = {
            firstSeenAt: previousFirstSeenAt,
            notifications: [],
            unreadIds: []
        };
        this.updateSubjects();
        void this.saveToStorage();
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
        const nextNotifications = state.notifications.filter(notification => unreadIds.has(notification.id));
        if (nextNotifications.length === state.notifications.length) {
            return;
        }
        state.notifications = nextNotifications;
        state.unreadIds = state.unreadIds.filter(unreadId =>
            state.notifications.some(notification => notification.id === unreadId)
        );
        this.updateSubjects();
        void this.saveToStorage();
    }

    private async setup(): Promise<void> {
        await this.loadFromStorage();
        this.activeMeetingIdService.meetingIdObservable.subscribe(meetingId => {
            this.activeMeetingId = meetingId;
            this._hasActiveMeetingSubject.next(!!meetingId);
            this.meetingSubscriptions.unsubscribe();
            this.meetingSubscriptions = new Subscription();
            this.closeModelSubscriptions();
            this.resetWatchState();
            this.updateSubjects();
            if (!meetingId) {
                return;
            }
            const meetingState = this.getMeetingState(meetingId);
            if (!meetingState.firstSeenAt) {
                meetingState.firstSeenAt = Date.now();
                void this.saveToStorage();
            }
            void this.startModelSubscriptions(meetingId);
            this.meetingSubscriptions.add(
                this.motionRepo.getViewModelListObservable().subscribe(motions => this.onMotionsChange(meetingId, motions))
            );
            this.meetingSubscriptions.add(
                this.assignmentCandidateRepo
                    .getViewModelListObservable()
                    .subscribe(candidates => this.onCandidatesChange(meetingId, candidates))
            );
            this.meetingSubscriptions.add(
                this.agendaItemRepo
                    .getViewModelListObservable()
                    .subscribe(agendaItems => this.onAgendaItemsChange(meetingId, agendaItems))
            );
            this.markNotificationsAsReadByCurrentRoute();
        });
    }

    private onMotionsChange(meetingId: Id, motions: ViewMotion[]): void {
        if (!this.canSeeMotions()) {
            this.watchState.knownMotionIds = new Set(motions.map(motion => motion.id));
            this.watchState.motionsInitialized = true;
            return;
        }
        if (this.watchState.isBootstrapping) {
            this.watchState.knownMotionIds = new Set(motions.map(motion => motion.id));
            this.watchState.motionsInitialized = true;
            return;
        }
        const currentIds = new Set(motions.map(motion => motion.id));
        if (!this.watchState.motionsInitialized) {
            this.watchState.knownMotionIds = currentIds;
            this.watchState.motionsInitialized = true;
            return;
        }

        motions.forEach(motion => {
            if (this.watchState.knownMotionIds.has(motion.id)) {
                return;
            }
            if (this.isOwnMotion(motion)) {
                return;
            }
            const isAmendment = !!motion.lead_motion_id;
            this.addNotification(meetingId, {
                type: isAmendment ? `amendment` : `motion`,
                title: motion.title || motion.number || `#${motion.sequential_number}`,
                subtitle: isAmendment ? `Motions / Amendments` : `Motions`,
                route: [`/`, `${meetingId}`, `motions`, `${motion.sequential_number}`],
                templateKey: isAmendment ? `notification.motion.amendment_created` : `notification.motion.created`,
                templateParams: { motionNumber: motion.sequential_number },
                entityType: `motion`,
                entityId: motion.id,
                groupKey: `motion:${motion.id}`
            });
        });

        this.watchState.knownMotionIds = currentIds;
    }

    private onCandidatesChange(meetingId: Id, candidates: ViewAssignmentCandidate[]): void {
        if (!this.canSeeAssignments()) {
            this.watchState.knownCandidateIds = new Set(candidates.map(candidate => candidate.id));
            this.watchState.candidatesInitialized = true;
            return;
        }
        if (this.watchState.isBootstrapping) {
            this.watchState.knownCandidateIds = new Set(candidates.map(candidate => candidate.id));
            this.watchState.candidatesInitialized = true;
            return;
        }
        const currentIds = new Set(candidates.map(candidate => candidate.id));
        if (!this.watchState.candidatesInitialized) {
            this.watchState.knownCandidateIds = currentIds;
            this.watchState.candidatesInitialized = true;
            return;
        }

        candidates.forEach(candidate => {
            if (this.watchState.knownCandidateIds.has(candidate.id)) {
                return;
            }
            const operatorId = this.operator.operatorId;
            if (!!operatorId && candidate.user_id === operatorId) {
                const assignmentNumber = candidate.assignment?.sequential_number;
                this.addNotification(meetingId, {
                    type: `candidate_self`,
                    title: `You were added as candidate`,
                    subtitle: candidate.assignment?.title,
                    route: assignmentNumber
                        ? [`/`, `${meetingId}`, `assignments`, `${assignmentNumber}`]
                        : [`/`, `${meetingId}`, `assignments`],
                    templateKey: `notification.assignment.candidate_self_added`,
                    templateParams: { assignmentNumber: assignmentNumber || 0 },
                    entityType: `assignment_candidate`,
                    entityId: candidate.id,
                    groupKey: `assignment_candidate:${candidate.id}`
                });
                return;
            }
            if (!this.shouldNotifyCandidateAddition(candidate)) {
                return;
            }
            const assignmentNumber = candidate.assignment?.sequential_number;
            this.addNotification(meetingId, {
                type: `candidate`,
                title: candidate.user?.short_name || `New candidate`,
                subtitle: candidate.assignment?.title,
                route: assignmentNumber
                    ? [`/`, `${meetingId}`, `assignments`, `${assignmentNumber}`]
                    : [`/`, `${meetingId}`, `assignments`],
                templateKey: `notification.assignment.candidate_added`,
                templateParams: { assignmentNumber: assignmentNumber || 0 },
                entityType: `assignment_candidate`,
                entityId: candidate.id,
                groupKey: `assignment_candidate:${candidate.id}`
            });
        });

        this.watchState.knownCandidateIds = currentIds;
    }

    private onAgendaItemsChange(meetingId: Id, agendaItems: ViewAgendaItem[]): void {
        const snapshots = new Map<Id, AgendaSnapshotEntry>();
        agendaItems.forEach(item => {
            snapshots.set(item.id, this.createAgendaSnapshot(item));
        });
        if (!this.canSeeAgenda()) {
            this.watchState.agendaSnapshots = snapshots;
            this.watchState.agendaInitialized = true;
            return;
        }

        if (this.watchState.isBootstrapping) {
            this.watchState.agendaSnapshots = snapshots;
            this.watchState.agendaInitialized = true;
            return;
        }

        if (!this.watchState.agendaInitialized) {
            this.watchState.agendaSnapshots = snapshots;
            this.watchState.agendaInitialized = true;
            return;
        }

        snapshots.forEach((snapshot, id) => {
            const previousSnapshot = this.watchState.agendaSnapshots.get(id);
            if (!previousSnapshot) {
                if (!this.shouldNotifyAgendaAddition(snapshot)) {
                    return;
                }
                this.addNotification(meetingId, {
                    type: `agenda_added`,
                    title: snapshot.title,
                    ...this.getAgendaNotificationTarget(meetingId, id, snapshot),
                    templateKey: `notification.agenda.item_added`,
                    templateParams: { agendaItemId: id },
                    entityType: this.getAgendaEntityType(snapshot),
                    entityId: this.getAgendaEntityId(id, snapshot),
                    groupKey: `agenda_item:${id}`
                });
                return;
            }
            if (previousSnapshot.contentSignature !== snapshot.contentSignature) {
                this.addNotification(meetingId, {
                    type: `agenda_updated`,
                    title: snapshot.title,
                    ...this.getAgendaNotificationTarget(meetingId, id, snapshot),
                    templateKey: `notification.agenda.item_updated`,
                    templateParams: { agendaItemId: id },
                    entityType: this.getAgendaEntityType(snapshot),
                    entityId: this.getAgendaEntityId(id, snapshot),
                    groupKey: `agenda_item:${id}`
                });
            }
        });

        this.watchState.agendaSnapshots.forEach((snapshot, id) => {
            if (snapshots.has(id)) {
                return;
            }
            this.addNotification(meetingId, {
                type: `agenda_removed`,
                title: snapshot.title,
                route: [`/`, `${meetingId}`, `agenda`],
                templateKey: `notification.agenda.item_removed`,
                templateParams: { agendaItemId: id },
                entityType: this.getAgendaEntityType(snapshot),
                entityId: this.getAgendaEntityId(id, snapshot),
                groupKey: `agenda_item:${id}`
            });
        });

        this.watchState.agendaSnapshots = snapshots;
    }

    private addNotification(
        meetingId: Id,
        payload: Omit<MeetingChangeNotification, `id` | `meetingId` | `createdAt`>
    ): void {
        if (!this.canSeeNotificationType(payload.type)) {
            return;
        }
        const meetingState = this.getMeetingState(meetingId);
        const notification: MeetingChangeNotification = {
            id: `${payload.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            meetingId,
            createdAt: Date.now(),
            ...payload
        };
        meetingState.notifications = [notification, ...meetingState.notifications].slice(0, MAX_NOTIFICATIONS_PER_MEETING);
        meetingState.unreadIds = [notification.id, ...meetingState.unreadIds].slice(0, MAX_NOTIFICATIONS_PER_MEETING);
        this.updateSubjects();
        void this.saveToStorage();
    }

    private getMeetingState(meetingId: Id): MeetingNotificationState {
        if (!this.byMeeting[meetingId]) {
            this.byMeeting[meetingId] = {
                notifications: [],
                unreadIds: []
            };
        }
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

    private resetWatchState(): void {
        this.watchState.isBootstrapping = false;
        this.watchState.motionsInitialized = false;
        this.watchState.knownMotionIds = new Set<Id>();
        this.watchState.candidatesInitialized = false;
        this.watchState.knownCandidateIds = new Set<Id>();
        this.watchState.agendaInitialized = false;
        this.watchState.agendaSnapshots = new Map<Id, AgendaSnapshotEntry>();
    }

    private createAgendaSnapshot(item: ViewAgendaItem): AgendaSnapshotEntry {
        return {
            title: this.agendaItemRepo.getTitle(item),
            contentObjectId: item.content_object_id,
            // Fields that mean "content changed".
            contentSignature: [item.closed, item.type, item.duration, item.comment, item.content_object_id].join(`|`),
            // Fields that mean order/position changed.
            orderSignature: [item.item_number, item.parent_id, item.weight].join(`|`)
        };
    }

    private shouldNotifyAgendaAddition(snapshot: AgendaSnapshotEntry): boolean {
        // If a motion is merely added to agenda, do not notify.
        return !snapshot.contentObjectId?.startsWith(`motion/`);
    }

    private canSeeMotions(): boolean {
        return this.operator.hasPerms(Permission.motionCanSee, Permission.motionCanSeeInternal);
    }

    private canSeeAssignments(): boolean {
        return this.operator.hasPerms(Permission.assignmentCanSee);
    }

    private canSeeAgenda(): boolean {
        return this.operator.hasPerms(Permission.agendaItemCanSee, Permission.agendaItemCanSeeInternal);
    }

    private canSeeNotificationType(type: MeetingNotificationType): boolean {
        switch (type) {
            case `motion`:
            case `amendment`:
                return this.canSeeMotions();
            case `candidate`:
            case `candidate_self`:
                return this.canSeeAssignments();
            case `agenda_added`:
            case `agenda_updated`:
            case `agenda_removed`:
                return this.canSeeAgenda();
        }
    }

    private getAgendaNotificationTarget(
        meetingId: Id,
        agendaItemId: Id,
        snapshot: AgendaSnapshotEntry
    ): Pick<MeetingChangeNotification, `route` | `queryParams`> {
        const topicPrefix = `topic/`;
        if (snapshot.contentObjectId?.startsWith(topicPrefix)) {
            const topicId = snapshot.contentObjectId.slice(topicPrefix.length);
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

    private getAgendaEntityType(snapshot: AgendaSnapshotEntry): `agenda_item` | `topic` {
        return snapshot.contentObjectId?.startsWith(`topic/`) ? `topic` : `agenda_item`;
    }

    private getAgendaEntityId(agendaItemId: Id, snapshot: AgendaSnapshotEntry): Id {
        const topicPrefix = `topic/`;
        if (snapshot.contentObjectId?.startsWith(topicPrefix)) {
            const topicId = Number(snapshot.contentObjectId.slice(topicPrefix.length));
            if (!!topicId) {
                return topicId;
            }
        }
        return agendaItemId;
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
            this.byMeeting[meetingId] = {
                firstSeenAt: meetingState.firstSeenAt,
                notifications,
                unreadIds
            };
        });
    }

    private async saveToStorage(): Promise<void> {
        await this.storage.set(STORAGE_KEY, { byMeeting: this.byMeeting });
    }

    private async startModelSubscriptions(meetingId: Id): Promise<void> {
        this.watchState.isBootstrapping = true;
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
        try {
            await Promise.allSettled([
                this.modelRequestService.subscribeTo(motionConfig),
                this.modelRequestService.subscribeTo(assignmentConfig),
                this.modelRequestService.subscribeTo(agendaConfig)
            ]);
            await Promise.allSettled([
                this.modelRequestService.waitSubscriptionReady(NOTIFICATION_MOTION_SUBSCRIPTION, 6000),
                this.modelRequestService.waitSubscriptionReady(NOTIFICATION_ASSIGNMENT_SUBSCRIPTION, 6000),
                this.modelRequestService.waitSubscriptionReady(NOTIFICATION_AGENDA_SUBSCRIPTION, 6000)
            ]);
        } finally {
            if (this.activeMeetingId !== meetingId) {
                return;
            }
            this.initializeBaselinesFromCurrentData();
            this.watchState.isBootstrapping = false;
        }
    }

    private initializeBaselinesFromCurrentData(): void {
        this.watchState.knownMotionIds = new Set(this.motionRepo.getViewModelList().map(motion => motion.id));
        this.watchState.motionsInitialized = true;

        this.watchState.knownCandidateIds = new Set(
            this.assignmentCandidateRepo.getViewModelList().map(candidate => candidate.id)
        );
        this.watchState.candidatesInitialized = true;

        const snapshots = new Map<Id, AgendaSnapshotEntry>();
        this.agendaItemRepo.getViewModelList().forEach(item => {
            snapshots.set(item.id, this.createAgendaSnapshot(item));
        });
        this.watchState.agendaSnapshots = snapshots;
        this.watchState.agendaInitialized = true;
    }

    private closeModelSubscriptions(): void {
        this.modelRequestService.closeSubscription(NOTIFICATION_MOTION_SUBSCRIPTION);
        this.modelRequestService.closeSubscription(NOTIFICATION_ASSIGNMENT_SUBSCRIPTION);
        this.modelRequestService.closeSubscription(NOTIFICATION_AGENDA_SUBSCRIPTION);
    }

    private isOwnMotion(motion: ViewMotion): boolean {
        const operatorId = this.operator.operatorId;
        if (!operatorId) {
            return false;
        }
        return (
            !!motion.submitters?.some(submitter => submitter.user_id === operatorId) ||
            motion.submittersAsUsers.some(user => user?.id === operatorId)
        );
    }

    private shouldNotifyCandidateAddition(candidate: ViewAssignmentCandidate): boolean {
        const operatorId = this.operator.operatorId;
        if (!operatorId) {
            return true;
        }
        return candidate.user_id !== operatorId;
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
        void this.saveToStorage();
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
                // Backward-compatibility for already persisted older notifications.
                if (urlTree.queryParamMap.getAll(`agenda-items`).includes(`${notification.queryParams?.[`agenda-items`]}`)) {
                    return true;
                }
                return false;
            case `agenda_removed`:
                return false;
        }
    }
}
