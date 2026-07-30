import { ApiProperty } from "@nestjs/swagger";

export class SaveUserSnapshotDto {
  @ApiProperty({ type: Object, additionalProperties: true })
  payload!: unknown;

  @ApiProperty({ example: "2026-07-27T15:00:00.000Z" })
  savedAt!: string;

  @ApiProperty({ example: "2026-07-27T15:15:00.000Z" })
  expiresAt!: string;
}

export class UserSnapshotDto extends SaveUserSnapshotDto {
  @ApiProperty() scope!: string;
  @ApiProperty() key!: string;
}
