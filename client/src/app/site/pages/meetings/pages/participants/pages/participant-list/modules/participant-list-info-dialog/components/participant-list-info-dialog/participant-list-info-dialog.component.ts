import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { BehaviorSubject, Observable } from 'rxjs';
import { Permission } from 'src/app/domain/definitions/permission';
import { Selectable } from 'src/app/domain/interfaces/selectable';
import { GENDERS } from 'src/app/domain/models/users/user';
import { ViewGroup } from 'src/app/site/pages/meetings/pages/participants';
import { GroupControllerService } from 'src/app/site/pages/meetings/pages/participants/modules';
import { ParticipantControllerService } from 'src/app/site/pages/meetings/pages/participants/services/common/participant-controller.service';
import { MeetingSettingsService } from 'src/app/site/pages/meetings/services/meeting-settings.service';
import { ViewMeetingUser } from 'src/app/site/pages/meetings/view-models/view-meeting-user';
import { ViewUser } from 'src/app/site/pages/meetings/view-models/view-user';
import { OperatorService } from 'src/app/site/services/operator.service';
import { BaseUiComponent } from 'src/app/ui/base/base-ui-component';

import { StructureLevelControllerService } from '../../../../../structure-levels/services/structure-level-controller.service';
import { ViewStructureLevel } from '../../../../../structure-levels/view-models';
import { ParticipantListSortService } from '../../../../services/participant-list-sort/participant-list-sort.service';
import { InfoDialog } from '../../services/participant-list-info-dialog.service';

@Component({
    selector: `os-participant-list-info-dialog`,
    templateUrl: `./participant-list-info-dialog.component.html`,
    styleUrls: [`./participant-list-info-dialog.component.scss`],
    standalone: false
})
export class ParticipantListInfoDialogComponent extends BaseUiComponent implements OnInit, OnDestroy {
    public readonly genders = GENDERS;

    public get groupsObservable(): Observable<ViewGroup[]> {
        return this.groupRepo.getViewModelListWithoutSystemGroupsObservable();
    }

    public get otherParticipantsObservable(): Observable<ViewMeetingUser[]> {
        return this._otherParticipantsSubject;
    }

    public get showVoteDelegations(): boolean {
        return this._voteDelegationEnabled;
    }

    public get canDelegateVote(): boolean {
        return (this.infoDialog.vote_delegations_from_ids ?? []).length === 0;
    }

    public get canReceiveDelegations(): boolean {
        return (this.infoDialog.vote_delegated_to_ids ?? []).length === 0;
    }

    public get canOnlyEditOwnDelegation(): boolean {
        return (
            this.operator.hasPerms(Permission.userCanEditOwnDelegation) &&
            !this.operator.hasPerms(Permission.userCanManage) &&
            !this.operator.hasPerms(Permission.userCanUpdate)
        );
    }

    public structureLevelObservable: Observable<ViewStructureLevel[]>;

    private readonly _otherParticipantsSubject = new BehaviorSubject<ViewMeetingUser[]>([]);
    private _currentUser: ViewUser | null = null;
    private _voteDelegationEnabled = false;
    private _voteDelegationsMaxAmount = 1;

    public constructor(
        @Inject(MAT_DIALOG_DATA) public readonly infoDialog: InfoDialog,
        private participantRepo: ParticipantControllerService,
        private userSortService: ParticipantListSortService,
        private groupRepo: GroupControllerService,
        private structureLevelRepo: StructureLevelControllerService,
        private meetingSettings: MeetingSettingsService,
        private operator: OperatorService
    ) {
        super();
    }

    public ngOnInit(): void {
        this.userSortService.initSorting();
        this._currentUser = this.participantRepo.getViewModel(this.infoDialog.id);
        this.structureLevelObservable = this.structureLevelRepo.getViewModelListObservable();
        this.subscriptions.push(
            this.participantRepo
                .getSortedViewModelListObservable(this.userSortService.repositorySortingKey)
                .subscribe(participants =>
                    this._otherParticipantsSubject.next(
                        participants
                            .filter(participant => participant.id !== this._currentUser.id)
                            .map(participant => participant.getMeetingUser())
                    )
                ),
            this.meetingSettings
                .get(`users_enable_vote_delegations`)
                .subscribe(enabled => (this._voteDelegationEnabled = enabled)),
            this.meetingSettings
                .get(`users_vote_delegations_max_amount`)
                .subscribe(maxAmount => (this._voteDelegationsMaxAmount = maxAmount ?? 1))
        );
    }

    public override ngOnDestroy(): void {
        this.userSortService.exitSortService();
        super.ngOnDestroy();
    }

    public readonly isDelegationsFromOptionDisabledFn = (value: Selectable): boolean =>
        this.isDelegationsFromOptionDisabled(value);

    public readonly isDelegationsToOptionDisabledFn = (value: Selectable): boolean =>
        this.isDelegationsToOptionDisabled(value);

    public isDelegationsFromOptionDisabled(value: Selectable): boolean {
        const selectedIds = (this.infoDialog.vote_delegations_from_ids ?? []).filter(id => !!id);
        if (selectedIds.includes(value.id)) {
            return false;
        }
        if (
            this.canOnlyEditOwnDelegation ||
            !this.canReceiveDelegations ||
            value.id === this._currentUser?.getMeetingUser()?.id
        ) {
            return true;
        }

        const meetingUser = value as ViewMeetingUser;
        const ownMeetingUserId = this._currentUser?.getMeetingUser()?.id;
        const targetDelegatedToIds = meetingUser.vote_delegated_to_ids ?? [];
        const targetAlreadyDelegatesToCurrent =
            ownMeetingUserId !== undefined && targetDelegatedToIds.includes(ownMeetingUserId);
        const targetWouldExceedMaxAmount =
            !targetAlreadyDelegatesToCurrent && targetDelegatedToIds.length >= this._voteDelegationsMaxAmount;
        const targetDelegationsFromIds = meetingUser.vote_delegations_from_ids ?? [];
        const targetReceivesIncompatibleDelegations =
            targetDelegationsFromIds.length > 0 &&
            (ownMeetingUserId === undefined ||
                targetDelegationsFromIds.length !== 1 ||
                targetDelegationsFromIds[0] !== ownMeetingUserId);

        return targetWouldExceedMaxAmount || targetReceivesIncompatibleDelegations;
    }

    public isDelegationsToOptionDisabled(value: Selectable): boolean {
        const meetingUser = value as ViewMeetingUser;
        const selectedIds = (this.infoDialog.vote_delegated_to_ids ?? []).filter(id => !!id);
        if (selectedIds.includes(value.id)) {
            return false;
        }
        if (!this.canDelegateVote || value.id === this._currentUser?.getMeetingUser()?.id) {
            return true;
        }
        const maxAmountReached = selectedIds.length >= this._voteDelegationsMaxAmount;
        const ownMeetingUserId = this._currentUser?.getMeetingUser()?.id;
        const targetDelegatedToIds = meetingUser.vote_delegated_to_ids ?? [];
        const targetHasIncompatibleDelegation =
            targetDelegatedToIds.length > 0 &&
            (ownMeetingUserId === undefined || !targetDelegatedToIds.includes(ownMeetingUserId));
        return (
            maxAmountReached ||
            (this.infoDialog.vote_delegations_from_ids ?? []).includes(value.id) ||
            targetHasIncompatibleDelegation
        );
    }
}
