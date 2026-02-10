import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AssignmentDetailComponent } from './components/assignment-detail/assignment-detail.component';
import { AssignmentCandidateDetailComponent } from './components/assignment-candidate-detail/assignment-candidate-detail.component';

const routes: Routes = [
    {
        path: ``,
        component: AssignmentDetailComponent
    },
    {
        path: `candidate/:candidateId/edit`,
        component: AssignmentCandidateDetailComponent
    },
    {
        path: `candidate/:candidateId`,
        component: AssignmentCandidateDetailComponent,
        pathMatch: `full`
    }
];

@NgModule({
    imports: [RouterModule.forChild(routes)],
    exports: [RouterModule]
})
export class AssignmentDetailRoutingModule {}
