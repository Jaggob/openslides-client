import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EntitledUsersTableComponent, getDelegatedToShortNames } from './entitled-users-table.component';

xdescribe(`EntitledUsersTableComponent`, () => {
    let component: EntitledUsersTableComponent;
    let fixture: ComponentFixture<EntitledUsersTableComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [EntitledUsersTableComponent]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EntitledUsersTableComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it(`should create`, () => {
        expect(component).toBeTruthy();
    });
});

describe(`getDelegatedToShortNames`, () => {
    it(`joins all delegated users instead of only showing the first one`, () => {
        const users = [{ getShortName: () => `Alice Adams` }, { getShortName: () => `Bob Brown` }];

        expect(getDelegatedToShortNames(users)).toBe(`Alice Adams, Bob Brown`);
    });

    it(`returns an empty string without delegated users`, () => {
        expect(getDelegatedToShortNames([])).toBe(``);
    });
});
