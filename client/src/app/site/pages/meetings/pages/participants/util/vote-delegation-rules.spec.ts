import {
    targetHasIncompatibleOutgoingDelegation,
    targetReceivesIncompatibleDelegations,
    targetWouldExceedMaxAmount
} from './vote-delegation-rules';

describe(`vote-delegation-rules`, () => {
    describe(`targetHasIncompatibleOutgoingDelegation`, () => {
        it(`is false when the target delegates to nobody`, () => {
            expect(targetHasIncompatibleOutgoingDelegation([], 100)).toBeFalse();
        });

        it(`is false when the target delegates only to the current user`, () => {
            expect(targetHasIncompatibleOutgoingDelegation([100], 100)).toBeFalse();
        });

        it(`is true when the target delegates elsewhere`, () => {
            expect(targetHasIncompatibleOutgoingDelegation([200], 100)).toBeTrue();
        });

        it(`is true when the current user has no meeting user`, () => {
            expect(targetHasIncompatibleOutgoingDelegation([200], undefined)).toBeTrue();
        });
    });

    describe(`targetWouldExceedMaxAmount`, () => {
        it(`is false when the target is below the cap`, () => {
            expect(targetWouldExceedMaxAmount([200], 100, 2)).toBeFalse();
        });

        it(`is true at the cap when not already delegating to the current user`, () => {
            expect(targetWouldExceedMaxAmount([200, 201], 100, 2)).toBeTrue();
        });

        it(`is false at the cap when already delegating to the current user`, () => {
            expect(targetWouldExceedMaxAmount([100, 201], 100, 2)).toBeFalse();
        });
    });

    describe(`targetReceivesIncompatibleDelegations`, () => {
        it(`is false when the target receives nothing`, () => {
            expect(targetReceivesIncompatibleDelegations([], 100)).toBeFalse();
        });

        it(`is false when the target receives only from the current user`, () => {
            expect(targetReceivesIncompatibleDelegations([100], 100)).toBeFalse();
        });

        it(`is true when the target receives from someone else`, () => {
            expect(targetReceivesIncompatibleDelegations([200], 100)).toBeTrue();
        });

        it(`is true when the target receives from multiple users`, () => {
            expect(targetReceivesIncompatibleDelegations([100, 200], 100)).toBeTrue();
        });
    });
});
