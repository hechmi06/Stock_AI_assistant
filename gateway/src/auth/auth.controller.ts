import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import type { AuthenticatedRequest } from "./auth.types";
import {
  AuthResponseDto,
  ChangePasswordRequestDto,
  LoginRequestDto,
  RegisterRequestDto,
  UpdateProfileRequestDto,
} from "./dto/auth.dto";
import { SessionAuthGuard } from "./session-auth.guard";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: "Creer un compte utilisateur" })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @Post("register")
  async register(
    @Body() input: RegisterRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(input, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
    });
    response.setHeader("Set-Cookie", this.authService.sessionCookie(result.token));
    return { user: result.user };
  }

  @ApiOperation({ summary: "Ouvrir une session utilisateur" })
  @ApiOkResponse({ type: AuthResponseDto })
  @HttpCode(200)
  @Post("login")
  async login(
    @Body() input: LoginRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(input, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
    });
    response.setHeader("Set-Cookie", this.authService.sessionCookie(result.token));
    return { user: result.user };
  }

  @ApiOperation({ summary: "Retourner l'utilisateur connecte" })
  @ApiOkResponse({ type: AuthResponseDto })
  @UseGuards(SessionAuthGuard)
  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    return { user: request.user };
  }

  @ApiOperation({ summary: "Mettre a jour le profil utilisateur" })
  @ApiOkResponse({ type: AuthResponseDto })
  @UseGuards(SessionAuthGuard)
  @Patch("profile")
  async updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateProfileRequestDto,
  ) {
    const user = await this.authService.updateProfile(request.user.id, input);
    return { user };
  }

  @ApiOperation({ summary: "Modifier le mot de passe du compte" })
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  @Patch("password")
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() input: ChangePasswordRequestDto,
  ) {
    await this.authService.changePassword(
      request.user.id,
      request.sessionToken,
      input,
    );
  }

  @ApiOperation({ summary: "Fermer la session utilisateur" })
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  @Post("logout")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.sessionToken);
    response.setHeader("Set-Cookie", this.authService.clearSessionCookie());
  }
}
