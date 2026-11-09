// The two headers between a form that posts with fetch (components/ui/ApiForm) and the route it posts to. A native post
// (no JavaScript) sends neither, and the route answers it with a 303 redirect as ever. A fetch sends the first, and a
// route that would redirect returns the destination in the second, usually with status 204. A brief save also returns
// its confirmed record. The form shows refusals inline and navigates to the destination when it accepts.

export const FORM_FETCH_HEADER = "x-form-fetch";
export const FORM_REDIRECT_HEADER = "x-form-redirect";

export const postedByForm = (request: Request) => request.headers.get(FORM_FETCH_HEADER) === "1";
