import { ProfileImage } from 'src/app/domain/models/profile-image/profile-image';
import { BaseViewModel, ViewModelRelations } from 'src/app/site/base/base-view-model';

import { ViewMediafile } from '../pages/mediafiles/view-models/view-mediafile';
import { ViewUser } from './view-user';

export class ViewProfileImage extends BaseViewModel<ProfileImage> {
    public static COLLECTION = ProfileImage.COLLECTION;

    public get profile_image(): ProfileImage {
        return this._model;
    }

    public get url(): string | null {
        return this.mediafile?.url ?? null;
    }
}

interface IProfileImageRelations {
    mediafile?: ViewMediafile;
    user?: ViewUser;
}

export interface ViewProfileImage extends ProfileImage, ViewModelRelations<IProfileImageRelations> {}
