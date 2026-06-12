import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParticipantCreateWizardComponent } from './participant-create-wizard.component';

xdescribe(`ParticipantCreateWizardComponent`, () => {
    let component: ParticipantCreateWizardComponent;
    let fixture: ComponentFixture<ParticipantCreateWizardComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [ParticipantCreateWizardComponent]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ParticipantCreateWizardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it(`should create`, () => {
        expect(component).toBeTruthy();
    });
});

describe(`ParticipantCreateWizardComponent delegation selector rules`, () => {
    function createComponent(): ParticipantCreateWizardComponent {
        const component = Object.create(ParticipantCreateWizardComponent.prototype) as ParticipantCreateWizardComponent;
        Object.defineProperty(component, `activeMeetingId`, { value: 1 });
        (component as any)._voteDelegationsMaxAmount = 2;
        (component as any).personalInfoFormValue = {
            vote_delegated_to_ids: []
        };
        return component;
    }

    it(`disables additional delegates after the configured maximum is reached`, () => {
        const component = createComponent();
        (component as any).personalInfoFormValue.vote_delegated_to_ids = [11, 12];
        const selectedUser = {
            id: 11,
            vote_delegated_to_ids: () => []
        } as any;
        const additionalUser = {
            id: 13,
            vote_delegated_to_ids: () => []
        } as any;

        expect(component.isDelegationsToOptionDisabledFn(selectedUser)).toBeFalse();
        expect(component.isDelegationsToOptionDisabledFn(additionalUser)).toBeTrue();
    });

    it(`disables targets that already delegate their own vote`, () => {
        const component = createComponent();
        const user = {
            id: 11,
            vote_delegated_to_ids: () => [100]
        } as any;

        expect(component.isDelegationsToOptionDisabledFn(user)).toBeTrue();
    });
});
