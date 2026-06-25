import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import { VotingService } from './voting.service';

xdescribe(`VotingService`, () => {
    let service: VotingService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(VotingService);
    });

    it(`should be created`, () => {
        expect(service).toBeTruthy();
    });
});

describe(`VotingService.votedBy`, () => {
    const MEETING_ID = 7;
    const REPRESENTED_MEETING_USER_ID = 110;

    function createService(
        ballots: any[],
        actingUser: any = null
    ): { service: VotingService; pollBallotsByUser: jasmine.Spy } {
        const pollBallotsByUser = jasmine.createSpy(`pollBallotsByUser`).and.returnValue(of(ballots));
        const service = Object.create(VotingService.prototype) as VotingService;
        (service as any).activeMeetingService = { meetingId: MEETING_ID };
        (service as any).pollRepo = { pollBallotsByUser };
        (service as any).meetingUserRepo = {
            getViewModelObservable: () => of(actingUser ? { user: actingUser } : null)
        };
        return { service, pollBallotsByUser };
    }

    const poll = { id: 1 } as any;
    // The user id and the meeting_user id deliberately differ: poll_ballot is
    // keyed by the meeting_user id, so the lookup must use the latter.
    const user = { id: 10, getMeetingUser: () => ({ id: REPRESENTED_MEETING_USER_ID }) } as any;

    it(`looks the ballot up by the represented meeting_user id, not the user id`, async () => {
        const { service, pollBallotsByUser } = createService([]);

        await firstValueFrom(service.votedBy(poll, user));

        expect(pollBallotsByUser).toHaveBeenCalledWith(poll.id, REPRESENTED_MEETING_USER_ID);
    });

    it(`returns the acting user when a ballot has been cast`, async () => {
        const actingUser = { id: 5, getShortName: () => `B` } as any;
        const { service } = createService([{ acting_meeting_user_id: 50 }], actingUser);

        expect(await firstValueFrom(service.votedBy(poll, user))).toBe(actingUser);
    });

    it(`returns null when no ballot has been cast`, async () => {
        const { service } = createService([]);

        expect(await firstValueFrom(service.votedBy(poll, user))).toBeNull();
    });

    it(`returns null when the ballot has no acting meeting user`, async () => {
        const { service } = createService([{ acting_meeting_user_id: undefined }]);

        expect(await firstValueFrom(service.votedBy(poll, user))).toBeNull();
    });

    it(`returns null when the acting meeting user has no resolved user`, async () => {
        const { service } = createService([{ acting_meeting_user_id: 50 }], null);

        expect(await firstValueFrom(service.votedBy(poll, user))).toBeNull();
    });

    it(`returns null without a repository lookup when the user has no meeting_user`, async () => {
        const { service, pollBallotsByUser } = createService([{ acting_meeting_user_id: 50 }]);
        const userWithoutMeetingUser = { id: 10, getMeetingUser: () => undefined } as any;

        expect(await firstValueFrom(service.votedBy(poll, userWithoutMeetingUser))).toBeNull();
        expect(pollBallotsByUser).not.toHaveBeenCalled();
    });
});

describe(`VotingService.hasVoted`, () => {
    const MEETING_ID = 7;
    const REPRESENTED_MEETING_USER_ID = 110;

    function createService(ballots: any[]): { service: VotingService; pollBallotsByUser: jasmine.Spy } {
        const pollBallotsByUser = jasmine.createSpy(`pollBallotsByUser`).and.returnValue(of(ballots));
        const service = Object.create(VotingService.prototype) as VotingService;
        (service as any).activeMeetingService = { meetingId: MEETING_ID };
        (service as any).pollRepo = { pollBallotsByUser };
        return { service, pollBallotsByUser };
    }

    const poll = { id: 1 } as any;
    // The user id and the meeting_user id deliberately differ.
    const user = { id: 10, getMeetingUser: () => ({ id: REPRESENTED_MEETING_USER_ID }) } as any;

    it(`looks the ballot up by the represented meeting_user id, not the user id`, async () => {
        const { service, pollBallotsByUser } = createService([]);

        await firstValueFrom(service.hasVoted(poll, user));

        expect(pollBallotsByUser).toHaveBeenCalledWith(poll.id, REPRESENTED_MEETING_USER_ID);
    });

    it(`is true when a ballot exists`, async () => {
        const { service } = createService([{ acting_meeting_user_id: 50 }]);

        expect(await firstValueFrom(service.hasVoted(poll, user))).toBeTrue();
    });

    it(`is false when no ballot exists`, async () => {
        const { service } = createService([]);

        expect(await firstValueFrom(service.hasVoted(poll, user))).toBeFalse();
    });

    it(`is false without a repository lookup when the user has no meeting_user`, async () => {
        const { service, pollBallotsByUser } = createService([{ acting_meeting_user_id: 50 }]);
        const userWithoutMeetingUser = { id: 10, getMeetingUser: () => undefined } as any;

        expect(await firstValueFrom(service.hasVoted(poll, userWithoutMeetingUser))).toBeFalse();
        expect(pollBallotsByUser).not.toHaveBeenCalled();
    });
});
