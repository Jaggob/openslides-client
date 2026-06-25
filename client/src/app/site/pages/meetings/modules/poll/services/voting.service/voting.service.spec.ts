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
    function createService(ballots: any[], actingUser: any = null): VotingService {
        const service = Object.create(VotingService.prototype) as VotingService;
        (service as any).pollRepo = {
            pollBallotsByUser: () => of(ballots)
        };
        (service as any).meetingUserRepo = {
            getViewModelObservable: () => of(actingUser ? { user: actingUser } : null)
        };
        return service;
    }

    const poll = { id: 1 } as any;
    const user = { id: 10 } as any;

    it(`returns the acting user when a ballot has been cast`, async () => {
        const actingUser = { id: 5, getShortName: () => `B` } as any;
        const service = createService([{ acting_meeting_user_id: 50 }], actingUser);

        expect(await firstValueFrom(service.votedBy(poll, user))).toBe(actingUser);
    });

    it(`returns null when no ballot has been cast`, async () => {
        const service = createService([]);

        expect(await firstValueFrom(service.votedBy(poll, user))).toBeNull();
    });

    it(`returns null when the ballot has no acting meeting user`, async () => {
        const service = createService([{ acting_meeting_user_id: undefined }]);

        expect(await firstValueFrom(service.votedBy(poll, user))).toBeNull();
    });

    it(`returns null when the acting meeting user has no resolved user`, async () => {
        const service = createService([{ acting_meeting_user_id: 50 }], null);

        expect(await firstValueFrom(service.votedBy(poll, user))).toBeNull();
    });
});
