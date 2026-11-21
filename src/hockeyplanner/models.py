from typing import Annotated, Literal, Self
from unicodedata import category
from uuid import UUID

from pydantic import AfterValidator, AliasChoices, BaseModel, ConfigDict, EmailStr, Field, FiniteFloat, StringConstraints, TypeAdapter, field_validator, model_validator

from pydantic_core import PydanticCustomError


AccountRole = Literal["user", "poweruser"]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]


PASSWORD_REQUIREMENTS = (
    "Use 12–128 characters, including at least one uppercase letter and one special character."
)


def require_strong_password(value: str) -> str:
    categories = {category(character) for character in value}
    if not (12 <= len(value) <= 128 and "Lu" in categories and any(c[0] in "PS" for c in categories)):
        raise PydanticCustomError("password_policy", PASSWORD_REQUIREMENTS)
    return value


StrongPassword = Annotated[str, AfterValidator(require_strong_password)]


Username = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[a-zA-Z0-9_.-]{3,32}$")]


class PlanShareRequest(BaseModel):
    username: Username


class PlanLinkClaim(BaseModel):
    token: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]


class PlanCopyRequest(BaseModel):
    id: UUID


class Credentials(BaseModel):
    username: Username
    password: Password


class Registration(Credentials):
    email: EmailStr
    password: StrongPassword


email_type = TypeAdapter(EmailStr)
username_type = TypeAdapter(Username)


class Login(BaseModel):
    identifier: str = Field(validation_alias=AliasChoices("identifier", "username", "email"), max_length=320)
    password: Password

    @field_validator("identifier")
    @classmethod
    def normalize_identifier(cls, identifier: str) -> str:
        identifier = identifier.strip()
        if "@" in identifier:
            return email_type.validate_python(identifier).casefold()
        return username_type.validate_python(identifier)


class EmailUpdate(BaseModel):
    email: EmailStr
    password: Password


class PasswordChange(BaseModel):
    current_password: Password
    new_password: StrongPassword


class UserProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: AccountRole = "user"
    enabled: bool = True


class AccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    role: AccountRole
    enabled: bool
    password: StrongPassword | None = None


class AccountProfile(UserProfile):
    email: str | None = None


class AccountStatus(BaseModel):
    user: AccountProfile | None


class Point(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)

    x: FiniteFloat
    y: FiniteFloat


class Marker(Point):
    type: Literal["player", "cone", "coach", "goal", "goalie", "puck", "pucks", "shot", "order", "referee"]
    team: Literal["A", "B"] | None = None
    number: Annotated[int, Field(ge=1, le=9)] | None = None
    rotation: FiniteFloat | None = None

    @model_validator(mode="after")
    def require_step_number(self) -> Self:
        if self.type == "order" and self.number is None:
            raise ValueError("Step markers require a number.")
        return self


class Movement(Point):
    type: Literal["forward", "carry", "stop", "carryStop", "backward", "backwardPuck", "backwardStop", "backwardPuckStop", "pass"]
    endX: FiniteFloat
    endY: FiniteFloat
    bendX: FiniteFloat | None = None
    bendY: FiniteFloat | None = None
    path: Annotated[list[Point], Field(min_length=2)] | None = None

    @model_validator(mode="after")
    def require_bend_pair(self) -> Self:
        if (self.bendX is None) != (self.bendY is None):
            raise ValueError("A curved movement requires both bend coordinates.")
        return self


RinkItem = Annotated[Marker | Movement, Field(discriminator="type")]


class Drill(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: UUID
    title: str
    description: str
    layout: Literal["full", "half", "quarter"] = "full"
    items: list[RinkItem]


class PracticePlan(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: UUID
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    activities: Annotated[list[Drill], Field(min_length=1)]


class LibraryImport(BaseModel):
    drills: list[object]
    plans: list[object]
