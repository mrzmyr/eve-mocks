import { allow } from "eve-mocks";

// One file per upstream that stays real: its name shows in `list` and in the run summary.
export default allow({ url: "https://example.com/" });
