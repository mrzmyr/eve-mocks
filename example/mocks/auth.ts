import { oauthToken, vercelConnect } from "eve-mocks";

const AUTH = [vercelConnect(), oauthToken({ url: "https://auth.example.com/oauth/token" })];

export default AUTH;
