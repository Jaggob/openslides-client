import { HistoryEntry } from 'src/app/domain/models/history-entry/history-entry';
import { BaseViewModel, ViewModelRelations } from 'src/app/site/base/base-view-model';
import { ViewAgendaItem } from 'src/app/site/pages/meetings/pages/agenda';
import { ViewAssignment } from 'src/app/site/pages/meetings/pages/assignments';
import { ViewAssignmentCandidate } from 'src/app/site/pages/meetings/pages/assignments';
import { ViewMotion } from 'src/app/site/pages/meetings/pages/motions';
import { ViewMeeting } from 'src/app/site/pages/meetings/view-models/view-meeting';
import { ViewUser } from 'src/app/site/pages/meetings/view-models/view-user';

import { ViewHistoryPosition } from '../history-position/view-history-position';

export class ViewHistoryEntry extends BaseViewModel<HistoryEntry> {
    public static COLLECTION = HistoryEntry.COLLECTION;

    public get historyEntry(): HistoryEntry {
        return this._model;
    }
}
interface IHistoryEntryRelations {
    position: ViewHistoryPosition;
    model?: ViewUser | ViewMotion | ViewAssignment | ViewAssignmentCandidate | ViewAgendaItem;
    meeting?: ViewMeeting;
}
export interface ViewHistoryEntry extends HistoryEntry, ViewModelRelations<IHistoryEntryRelations> {}
