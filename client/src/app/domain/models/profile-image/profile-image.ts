import { Id } from '../../definitions/key-types';
import { BaseModel } from '../base/base-model';

export class ProfileImage extends BaseModel<ProfileImage> {
    public static COLLECTION = `profile_image`;

    public user_id!: Id;
    public mediafile_id!: Id;
    public create_timestamp!: number;

    public constructor(input?: Partial<ProfileImage>) {
        super(ProfileImage.COLLECTION, input);
    }

    public static readonly REQUESTABLE_FIELDS: (keyof ProfileImage)[] = [
        `id`,
        `user_id`,
        `mediafile_id`,
        `create_timestamp`
    ];
}
export interface ProfileImage {}
