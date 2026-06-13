import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParticipantDetailEditComponent } from './participant-detail-edit.component';

xdescribe(`ParticipantDetailEditComponent`, () => {
    let component: ParticipantDetailEditComponent;
    let fixture: ComponentFixture<ParticipantDetailEditComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [ParticipantDetailEditComponent]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ParticipantDetailEditComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it(`should create`, () => {
        expect(component).toBeTruthy();
    });
});

describe(`ParticipantDetailEditComponent delegation selector rules`, () => {
    function createComponent(): ParticipantDetailEditComponent {
        const component = Object.create(ParticipantDetailEditComponent.prototype) as ParticipantDetailEditComponent;
        Object.defineProperty(component, `activeMeetingId`, { value: 1 });
        (component as any)._userId = 10;
        (component as any)._voteDelegationsMaxAmount = 2;
        (component as any).personalInfoFormValue = {
            vote_delegated_to_ids: [],
            vote_delegations_from_ids: []
        };
        (component as any).user = {
            getMeetingUser: () => ({ id: 100 }),
            vote_delegations_from_ids: () => []
        };
        return component;
    }

    it(`disables self delegation`, () => {
        const component = createComponent();
        const user = {
            id: 10,
            vote_delegated_to_meeting_user_ids: () => []
        } as any;

        expect(component.isDelegationsToOptionDisabledFn(user)).toBeTrue();
    });

    it(`disables additional delegates after the configured maximum is reached`, () => {
        const component = createComponent();
        (component as any).personalInfoFormValue.vote_delegated_to_ids = [11, 12];
        const selectedUser = {
            id: 11,
            vote_delegated_to_meeting_user_ids: () => []
        } as any;
        const additionalUser = {
            id: 13,
            vote_delegated_to_meeting_user_ids: () => []
        } as any;

        expect(component.isDelegationsToOptionDisabledFn(selectedUser)).toBeFalse();
        expect(component.isDelegationsToOptionDisabledFn(additionalUser)).toBeTrue();
    });

    it(`allows reversing an existing delegation if the target delegates to the current user`, () => {
        const component = createComponent();
        const user = {
            id: 11,
            vote_delegated_to_meeting_user_ids: () => [100]
        } as any;

        expect(component.isDelegationsToOptionDisabledFn(user)).toBeFalse();
    });

    it(`disables targets with incompatible existing delegations`, () => {
        const component = createComponent();
        const user = {
            id: 11,
            vote_delegated_to_meeting_user_ids: () => [200]
        } as any;

        expect(component.isDelegationsToOptionDisabledFn(user)).toBeTrue();
    });

    it(`disables delegates that are already selected as principals`, () => {
        const component = createComponent();
        (component as any).personalInfoFormValue.vote_delegations_from_ids = [11];
        const user = {
            id: 11,
            vote_delegated_to_meeting_user_ids: () => []
        } as any;

        expect(component.isDelegationsToOptionDisabledFn(user)).toBeTrue();
    });

    it(`disables principals that would exceed their delegation limit`, () => {
        const component = createComponent();
        const user = {
            id: 11,
            vote_delegated_to_meeting_user_ids: () => [200, 201],
            vote_delegations_from_meeting_user_ids: () => []
        } as any;

        expect(component.isDelegationsFromOptionDisabledFn(user)).toBeTrue();
    });

    it(`disables principals that receive incompatible delegations`, () => {
        const component = createComponent();
        const user = {
            id: 11,
            vote_delegated_to_meeting_user_ids: () => [],
            vote_delegations_from_meeting_user_ids: () => [200]
        } as any;

        expect(component.isDelegationsFromOptionDisabledFn(user)).toBeTrue();
    });

    it(`allows selected principals so they can be removed`, () => {
        const component = createComponent();
        (component as any).personalInfoFormValue.vote_delegations_from_ids = [11];
        const user = {
            id: 11,
            vote_delegated_to_meeting_user_ids: () => [200, 201],
            vote_delegations_from_meeting_user_ids: () => [200]
        } as any;

        expect(component.isDelegationsFromOptionDisabledFn(user)).toBeFalse();
    });
});
