import { ApiProperty } from "@nestjs/swagger";

export class RegisterRequestDto {
  @ApiProperty({ example: "Hichem Ben Salah" })
  displayName!: string;

  @ApiProperty({ example: "hichem@example.com" })
  email!: string;

  @ApiProperty({ example: "mot-de-passe-solide", minLength: 10 })
  password!: string;
}

export class LoginRequestDto {
  @ApiProperty({ example: "hichem@example.com" })
  email!: string;

  @ApiProperty({ example: "mot-de-passe-solide" })
  password!: string;
}

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ example: "user" }) role!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ example: "moderate" }) riskProfile!: string;
  @ApiProperty({ example: "long_term" }) investmentHorizon!: string;
  @ApiProperty({ example: "balanced" }) investmentObjective!: string;
  @ApiProperty({ example: "USD" }) baseCurrency!: string;
}

export class AuthResponseDto {
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}

export class UpdateProfileRequestDto {
  @ApiProperty({ example: "Hichem Ben Salah" })
  displayName!: string;

  @ApiProperty({
    enum: ["conservative", "moderate", "dynamic"],
    example: "moderate",
  })
  riskProfile!: string;

  @ApiProperty({
    enum: ["short_term", "medium_term", "long_term"],
    example: "long_term",
  })
  investmentHorizon!: string;

  @ApiProperty({
    enum: ["capital_preservation", "income", "balanced", "growth"],
    example: "balanced",
  })
  investmentObjective!: string;

  @ApiProperty({ enum: ["USD", "EUR", "TND"], example: "USD" })
  baseCurrency!: string;
}

export class ChangePasswordRequestDto {
  @ApiProperty()
  currentPassword!: string;

  @ApiProperty({ minLength: 10 })
  newPassword!: string;
}
