import { Id } from '../../definitions/key-types';
import { HasAttachmentMeetingMediafileIds } from '../../interfaces/has-attachment-ids';
import { HasMeetingId } from '../../interfaces/has-meeting-id';
import { HasProjectionIds } from '../../interfaces/has-projectable-ids';
import { BaseModel } from '../base/base-model';

/**
 * Content of the 'assignment_related_users' property.
 */
export class AssignmentCandidate extends BaseModel<AssignmentCandidate> {
    public static COLLECTION = `assignment_candidate`;

    public weight!: number;
    public application!: string;
    public list_of_speakers_id!: Id;
    public projection_ids!: Id[];
    public attachment_meeting_mediafile_ids!: Id[];

    public assignment_id!: Id; // assignment/candidate_ids;
    public meeting_user_id!: Id; // meeting_user/assignment_candidate_ids;

    public constructor(input?: any) {
        super(AssignmentCandidate.COLLECTION, input);
    }

    public static readonly REQUESTABLE_FIELDS: (keyof AssignmentCandidate)[] = [
        `id`,
        `weight`,
        `application`,
        `assignment_id`,
        `meeting_user_id`,
        `meeting_id`,
        `list_of_speakers_id`,
        `projection_ids`,
        `attachment_meeting_mediafile_ids`
    ];
}
export interface AssignmentCandidate extends HasMeetingId, HasAttachmentMeetingMediafileIds, HasProjectionIds {}
