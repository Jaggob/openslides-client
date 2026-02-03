import { Observable } from 'rxjs';
import { PROJECTIONDEFAULT, ProjectiondefaultValue } from 'src/app/domain/models/projector/projection-default';
import { ViewModelRelations } from 'src/app/site/base/base-view-model';
import { BaseProjectableViewModel } from 'src/app/site/pages/meetings/view-models';
import { ViewMeetingUser } from 'src/app/site/pages/meetings/view-models/view-meeting-user';
import { ViewUser } from 'src/app/site/pages/meetings/view-models/view-user';

import { AssignmentCandidate } from '../../../../../../domain/models/assignments/assignment-candidate';
import { HasListOfSpeakers } from '../../agenda/modules/list-of-speakers';
import { HasAttachmentMeetingMediafiles } from '../../mediafiles/view-models/has-attachment';
import { HasMeeting } from '../../../view-models/has-meeting';
import { ViewListOfSpeakers } from '../../agenda/modules/list-of-speakers/view-models/view-list-of-speakers';
import { ViewAssignment } from './view-assignment';

export class ViewAssignmentCandidate extends BaseProjectableViewModel<AssignmentCandidate> {
    public static COLLECTION = AssignmentCandidate.COLLECTION;
    protected _collection = AssignmentCandidate.COLLECTION;

    public get assignmentCandidate(): AssignmentCandidate {
        return this._model;
    }

    public meeting_user: ViewMeetingUser;
    public meeting_user$: Observable<ViewMeetingUser>;

    public get user(): ViewUser {
        return this.meeting_user?.user;
    }

    public get user_id(): number {
        return this.meeting_user?.user_id;
    }

    public override getDetailStateUrl(): string {
        if (this.assignment?.sequential_number && this.meeting_id) {
            return `/${this.meeting_id}/assignments/${this.assignment.sequential_number}/candidate/${this.id}`;
        }
        return super.getDetailStateUrl();
    }

    public getProjectiondefault(): ProjectiondefaultValue {
        return PROJECTIONDEFAULT.assignment;
    }
}

interface IAssignmentCandidateRelations {
    assignment: ViewAssignment;
    list_of_speakers?: ViewListOfSpeakers;
}
export interface ViewAssignmentCandidate
    extends
        AssignmentCandidate,
        ViewModelRelations<IAssignmentCandidateRelations>,
        HasMeeting,
        HasAttachmentMeetingMediafiles,
        HasListOfSpeakers {}
