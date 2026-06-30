import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParticipantListInfoDialogComponent } from './participant-list-info-dialog.component';

xdescribe(`ParticipantListInfoDialogComponent`, () => {
    let component: ParticipantListInfoDialogComponent;
    let fixture: ComponentFixture<ParticipantListInfoDialogComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [ParticipantListInfoDialogComponent]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ParticipantListInfoDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it(`should create`, () => {
        expect(component).toBeTruthy();
    });
});

describe(`ParticipantListInfoDialogComponent delegation selector rules`, () => {
    function createComponent(): ParticipantListInfoDialogComponent {
        const component = Object.create(
            ParticipantListInfoDialogComponent.prototype
        ) as ParticipantListInfoDialogComponent;
        (component as any)._voteDelegationsMaxAmount = 2;
        (component as any).operator = {
            hasPerms: () => false
        };
        (component as any)._currentUser = {
            getMeetingUser: () => ({ id: 100 })
        };
        (component as any).infoDialog = {
            vote_delegated_to_ids: [],
            vote_delegations_from_ids: []
        };
        return component;
    }

    it(`disables additional delegates after the configured maximum is reached`, () => {
        const component = createComponent();
        (component as any).infoDialog.vote_delegated_to_ids = [101, 102];
        const selectedMeetingUser = { id: 101, vote_delegated_to_ids: [] } as any;
        const additionalMeetingUser = { id: 103, vote_delegated_to_ids: [] } as any;

        expect(component.isDelegationsToOptionDisabled(selectedMeetingUser)).toBeFalse();
        expect(component.isDelegationsToOptionDisabled(additionalMeetingUser)).toBeTrue();
    });

    it(`allows reversing an existing delegation if the target delegates to the current meeting user`, () => {
        const component = createComponent();
        const meetingUser = { id: 101, vote_delegated_to_ids: [100] } as any;

        expect(component.isDelegationsToOptionDisabled(meetingUser)).toBeFalse();
    });

    it(`disables targets with incompatible existing delegations`, () => {
        const component = createComponent();
        const meetingUser = { id: 101, vote_delegated_to_ids: [200] } as any;

        expect(component.isDelegationsToOptionDisabled(meetingUser)).toBeTrue();
    });

    it(`disables self delegation as delegate`, () => {
        const component = createComponent();
        const meetingUser = { id: 100, vote_delegated_to_ids: [] } as any;

        expect(component.isDelegationsToOptionDisabled(meetingUser)).toBeTrue();
    });

    it(`disables principals that would exceed their delegation limit`, () => {
        const component = createComponent();
        const meetingUser = { id: 101, vote_delegated_to_ids: [200, 201], vote_delegations_from_ids: [] } as any;

        expect(component.isDelegationsFromOptionDisabled(meetingUser)).toBeTrue();
    });

    it(`disables principals that receive incompatible delegations`, () => {
        const component = createComponent();
        const meetingUser = { id: 101, vote_delegated_to_ids: [], vote_delegations_from_ids: [200] } as any;

        expect(component.isDelegationsFromOptionDisabled(meetingUser)).toBeTrue();
    });

    it(`allows selected principals so they can be removed`, () => {
        const component = createComponent();
        (component as any).infoDialog.vote_delegations_from_ids = [101];
        const meetingUser = { id: 101, vote_delegated_to_ids: [200, 201], vote_delegations_from_ids: [200] } as any;

        expect(component.isDelegationsFromOptionDisabled(meetingUser)).toBeFalse();
    });
});
