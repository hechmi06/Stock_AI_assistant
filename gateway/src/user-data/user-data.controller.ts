import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import {
  SaveUserSnapshotDto,
  UserSnapshotDto,
} from "./dto/user-snapshot.dto";
import { UserDataService } from "./user-data.service";

@ApiTags("user-data")
@ApiCookieAuth("stock_ai_session")
@UseGuards(SessionAuthGuard)
@Controller("user-data")
export class UserDataController {
  constructor(private readonly userDataService: UserDataService) {}

  @ApiOperation({ summary: "Lister les historiques du compte connecte" })
  @ApiOkResponse({ type: [UserSnapshotDto] })
  @Get("snapshots")
  list(@Req() request: AuthenticatedRequest) {
    return this.userDataService.list(request.user.id);
  }

  @ApiOperation({ summary: "Enregistrer un instantane utilisateur" })
  @ApiOkResponse({ type: UserSnapshotDto })
  @Put("snapshots/:scope/:key")
  save(
    @Req() request: AuthenticatedRequest,
    @Param("scope") scope: string,
    @Param("key") key: string,
    @Body() input: SaveUserSnapshotDto,
  ) {
    return this.userDataService.save(request.user.id, scope, key, input);
  }

  @ApiOperation({ summary: "Supprimer un instantane utilisateur" })
  @HttpCode(204)
  @Delete("snapshots/:scope/:key")
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param("scope") scope: string,
    @Param("key") key: string,
  ) {
    await this.userDataService.remove(request.user.id, scope, key);
  }
}
