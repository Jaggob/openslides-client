import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input } from '@angular/core';
import { combineLatest, debounceTime, distinctUntilChanged } from 'rxjs';
import { ParticipantControllerService } from 'src/app/site/pages/meetings/pages/participants/services/common/participant-controller.service/participant-controller.service';
import { OperatorService } from 'src/app/site/services/operator.service';

import { BaseMeetingComponent } from '../../../../base/base-meeting.component';
import { ViewPoll } from '../../../../pages/polls';
import { ViewUser } from '../../../../view-models/view-user';
import { VotingService } from '../../services/voting.service';

@Component({
    selector: `os-poll-cannot-vote-message`,
    templateUrl: `./poll-cannot-vote-message.component.html`,
    styleUrls: [`./poll-cannot-vote-message.component.scss`],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class PollCannotVoteMessageComponent extends BaseMeetingComponent {
    @Input()
    public delegationUser: ViewUser;

    @Input()
    public hasAlreadyVoted: boolean;

    @Input()
    public isDeliveringVote = false;

    @Input()
    public hasDelegations = false;

    @Input()
    public poll: ViewPoll;

    public user: ViewUser;

    public get isUserPresent(): boolean {
        return this.user?.isPresentInMeeting();
    }

    public get voteSuccessBy(): string | null {
        const targetUser = this.delegationUser ?? this.user;
        if (!targetUser || !this.poll) {
            return null;
        }

        const actorId = this.poll.getVoteActorIdForUser?.(targetUser.id) ?? null;
        const actorUser = actorId ? this.userRepo.getViewModel(actorId) : null;

        if (this.delegationUser) {
            if (actorUser) {
                return actorUser.getTitle();
            }
            if (actorId && actorId === this.delegationUser.id) {
                return this.delegationUser.getTitle();
            }
            if (actorId && this.user && actorId === this.user.id) {
                return this.user.getTitle();
            }
            return null;
        }

        if (actorUser && actorUser.id !== targetUser.id) {
            return actorUser.getTitle();
        }

        return null;
    }

    public constructor(
        operator: OperatorService,
        private votingService: VotingService,
        private userRepo: ParticipantControllerService,
        private cd: ChangeDetectorRef
    ) {
        super();
        this.subscriptions.push(
            operator.userObservable.pipe(debounceTime(50)).subscribe(user => {
                if (user) {
                    this.user = user;
                }
                this.cd.markForCheck();
            })
        );
        this.subscriptions.push(
            combineLatest([
                this.meetingSettingsService.get(`users_enable_vote_delegations`).pipe(distinctUntilChanged()),
                this.meetingSettingsService.get(`users_forbid_delegator_to_vote`).pipe(distinctUntilChanged())
            ]).subscribe(_ => {
                this.cd.markForCheck();
            })
        );
    }

    public getVotingError(user: ViewUser = this.user): string {
        return this.votingService.getVotingProhibitionReasonVerbose(this.poll, user) || ``;
    }

    public getVotingErrorFromName(errorName: string): string {
        return this.votingService.getVotingProhibitionReasonVerboseFromName(errorName) || ``;
    }
}
