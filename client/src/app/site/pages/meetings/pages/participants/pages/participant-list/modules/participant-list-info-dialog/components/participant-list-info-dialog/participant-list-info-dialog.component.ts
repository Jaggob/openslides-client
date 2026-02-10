import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { BehaviorSubject, map, Observable } from 'rxjs';
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

    public get delegationsFromParticipantsObservable(): Observable<ViewMeetingUser[]> {
        return this._otherParticipantsSubject.pipe(
            map(participants =>
                this.canReceiveDelegations
                    ? participants.filter(user => (user.vote_delegations_from?.length ?? 0) === 0)
                    : []
            )
        );
    }

    public get delegationsToParticipantsObservable(): Observable<ViewMeetingUser[]> {
        return this._otherParticipantsSubject;
    }

    public get showVoteDelegations(): boolean {
        return this._voteDelegationEnabled;
    }

    public get canDelegateVote(): boolean {
        return (this._currentUser?.vote_delegations_from()?.length ?? 0) === 0;
    }

    public get canReceiveDelegations(): boolean {
        const delegatedToIds = this.infoDialog.vote_delegated_to_ids;
        if (delegatedToIds) {
            return delegatedToIds.length === 0;
        }
        return (this._currentUser?.vote_delegated_to()?.length ?? 0) === 0;
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
                .subscribe(enabled => (this._voteDelegationEnabled = enabled))
        );
    }

    public override ngOnDestroy(): void {
        this.userSortService.exitSortService();
        super.ngOnDestroy();
    }

    public readonly isDelegationsFromOptionDisabledFn = (value: Selectable): boolean => {
        if (this.canOnlyEditOwnDelegation) {
            return this.infoDialog.vote_delegations_from_ids
                ? !this.infoDialog.vote_delegations_from_ids.some(x => x === value.id)
                : true;
        }
        if (!this.canReceiveDelegations) {
            return true;
        }
        const toIds = this.infoDialog.vote_delegated_to_ids || [];
        return toIds.includes(value.id);
    };

    public readonly isDelegationsToOptionDisabledFn = (value: Selectable): boolean => {
        if (!this.canDelegateVote) {
            return true;
        }
        const fromIds = this.infoDialog.vote_delegations_from_ids || [];
        return fromIds.includes(value.id);
    };
}
