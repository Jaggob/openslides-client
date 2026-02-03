import { Injectable } from '@angular/core';
import { Id } from 'src/app/domain/definitions/key-types';
import { Identifiable } from 'src/app/domain/interfaces';
import { Action } from 'src/app/gateways/actions';
import { AgendaItemRepositoryService } from 'src/app/gateways/repositories/agenda';
import { BaseAgendaItemAndListOfSpeakersContentObjectRepository } from 'src/app/gateways/repositories/base-agenda-item-and-list-of-speakers-content-object-repository';
import { ViewAssignmentCandidate } from 'src/app/site/pages/meetings/pages/assignments';
import { AgendaListTitle } from 'src/app/site/pages/meetings/pages/agenda';
import { UnknownUserLabel } from 'src/app/site/pages/meetings/pages/assignments/modules/assignment-poll/services/assignment-poll.service';

import { AssignmentCandidate } from '../../../../domain/models/assignments/assignment-candidate';
import { RepositoryMeetingServiceCollectorService } from '../../repository-meeting-service-collector.service';
import { AssignmentCandidateAction } from './assignment-candidate.action';

@Injectable({
    providedIn: `root`
})
export class AssignmentCandidateRepositoryService extends BaseAgendaItemAndListOfSpeakersContentObjectRepository<
    ViewAssignmentCandidate,
    AssignmentCandidate
> {
    public constructor(
        repositoryServiceCollector: RepositoryMeetingServiceCollectorService,
        agendaItemRepo: AgendaItemRepositoryService
    ) {
        super(repositoryServiceCollector, AssignmentCandidate, agendaItemRepo);
    }

    public getTitle = (viewAssignmentCandidate: ViewAssignmentCandidate): string =>
        viewAssignmentCandidate.user?.getTitle() ?? UnknownUserLabel;

    public getVerboseName = (plural = false): string => this.translate.instant(plural ? `Candidates` : `Candidate`);

    public override getAgendaListTitle(viewAssignmentCandidate: ViewAssignmentCandidate): AgendaListTitle {
        const candidateName = viewAssignmentCandidate.user?.short_name || UnknownUserLabel;
        const assignmentName = viewAssignmentCandidate.assignment?.title || ``;
        const title = assignmentName
            ? `${assignmentName} · ${candidateName}`
            : `${candidateName}`;
        return { title };
    }

    public async create(assignment: Identifiable, meetingUserId: Id): Promise<Identifiable> {
        const payload = {
            assignment_id: assignment.id,
            meeting_user_id: meetingUserId
        };
        return this.sendActionToBackend(AssignmentCandidateAction.CREATE, payload);
    }

    public delete(candidate: Identifiable): Action<void> {
        const payload: Identifiable = { id: candidate.id };
        return this.createAction(AssignmentCandidateAction.DELETE, [payload]);
    }

    public update(
        candidate: Identifiable,
        payload: Partial<AssignmentCandidate> & { attachment_mediafile_ids?: Id[] }
    ): Action<Identifiable> {
        return this.createAction(AssignmentCandidateAction.UPDATE, [{ id: candidate.id, ...payload }]);
    }

    /**
     * Sends a request to sort an assignment's candidates
     *
     * @param sortedCandidates the id of the assignment related users (note: NOT viewUsers)
     * @param assignment
     */
    public async sort(assignment: Identifiable, sortedCandidates: Identifiable[]): Promise<void> {
        const payload = {
            candidate_ids: sortedCandidates.map(candidate => candidate.id),
            assignment_id: assignment.id
        };
        return this.sendActionToBackend(AssignmentCandidateAction.SORT, payload);
    }
}
