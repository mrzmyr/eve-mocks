import { defineHttpMock } from "eve-mocks";

export default defineHttpMock({
  url: "https://api.notion.com/",
  routes: {
    "/v1/users/{user_id}": {
      GET: ({ params }) => {
        return { object: "user", id: params.user_id, type: "bot" };
      },
    },
  },
});
