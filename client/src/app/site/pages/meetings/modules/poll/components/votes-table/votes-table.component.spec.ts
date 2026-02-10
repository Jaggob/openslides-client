import { VotesFilterService } from '../../services/votes-filter.service';
import { VotesTableComponent } from './votes-table.component';

describe(`VotesTableComponent`, () => {
    let component: VotesTableComponent;

    beforeEach(() => {
        component = new VotesTableComponent({} as VotesFilterService);
    });

    it(`returns null when no delegated user is present`, () => {
        const vote: any = { user: { id: 1 } };
        expect(component.getDelegationActorName(vote)).toBeNull();
    });

    it(`returns null when the delegated user equals the vote user`, () => {
        const user = { id: 1, getShortName: () => `Alice` };
        const vote: any = { user, delegated_user: { user } };
        expect(component.getDelegationActorName(vote)).toBeNull();
    });

    it(`returns the delegated user short name when different`, () => {
        const vote: any = {
            user: { id: 1, getShortName: () => `Alice` },
            delegated_user: { user: { id: 2, getShortName: () => `Bob` } }
        };
        expect(component.getDelegationActorName(vote)).toBe(`Bob`);
    });
});
