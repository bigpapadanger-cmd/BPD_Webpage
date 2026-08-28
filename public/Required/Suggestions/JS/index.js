/* BPD GAMING NETWORK - FAQ */

const FAQ_API_URL = "/api/faq";
const FAQ_UPVOTE_URL = "/api/faq/upvote";
const FAQ_SUGGEST_URL = "/faq/suggest";

const faqList =
    document.getElementById("faqList");

const faqSuggestionButton =
    document.getElementById(
        "faqSuggestionButton"
    );

const faqLoginModal =
    document.getElementById(
        "faqLoginModal"
    );

const faqLoginMessage =
    document.getElementById(
        "faqLoginMessage"
    );

const faqLoginButton =
    document.getElementById(
        "faqLoginButton"
    );


let pendingAuthAction = null;


/*
=========================================================
INITIALIZE
=========================================================
*/

document.addEventListener(
    "DOMContentLoaded",
    initializeFaqPage
);


async function initializeFaqPage() {

    await loadFaqs();

    bindFaqSuggestion();

    bindLoginModal();

}


/*
=========================================================
LOAD FAQ DATA
=========================================================
*/

async function loadFaqs() {

    try {

        const response =
            await fetch(
                FAQ_API_URL,
                {
                    credentials:
                        "include",
                    cache:
                        "no-store"
                }
            );


        if (!response.ok) {

            faqList.replaceChildren();

            return;

        }


        const result =
            await response.json();


        const faqs =
            Array.isArray(result)
                ? result
                : Array.isArray(result.faqs)
                    ? result.faqs
                    : [];


        renderFaqs(faqs);

    }
    catch (error) {

        console.error(
            "Unable to load FAQs:",
            error
        );

        faqList.replaceChildren();

    }

}


/*
=========================================================
RENDER FAQ DATA
=========================================================
*/

function renderFaqs(faqs) {

    faqList.replaceChildren();


    if (
        !Array.isArray(faqs) ||
        faqs.length === 0
    ) {

        return;

    }


    const fragment =
        document.createDocumentFragment();


    faqs.forEach(
        faq => {

            const faqElement =
                createFaqElement(faq);

            fragment.appendChild(
                faqElement
            );

        }
    );


    faqList.appendChild(
        fragment
    );

}


/*
=========================================================
CREATE FAQ ITEM
=========================================================
*/

function createFaqElement(faq) {

    const item =
        document.createElement("article");

    item.className =
        "faq-item";

    item.dataset.faqId =
        String(
            faq.id ?? ""
        );


    const main =
        document.createElement("div");

    main.className =
        "faq-item-main";


    const voteContainer =
        document.createElement("div");

    voteContainer.className =
        "faq-vote";


    const upvoteButton =
        document.createElement("button");

    upvoteButton.type =
        "button";

    upvoteButton.className =
        "faq-upvote-button";

    upvoteButton.setAttribute(
        "aria-label",
        `Upvote ${faq.question || "FAQ"}`
    );

    upvoteButton.textContent =
        "▲";


    if (faq.userUpvoted === true) {

        upvoteButton.classList.add(
            "voted"
        );

    }


    const voteCount =
        document.createElement("span");

    voteCount.className =
        "faq-upvote-count";

    voteCount.textContent =
        formatVoteCount(
            faq.upvotes
        );


    voteContainer.append(
        upvoteButton,
        voteCount
    );


    const questionButton =
        document.createElement("button");

    questionButton.type =
        "button";

    questionButton.className =
        "faq-question-button";

    questionButton.setAttribute(
        "aria-expanded",
        "false"
    );


    const questionContent =
        document.createElement("div");

    questionContent.className =
        "faq-question-content";


    const question =
        document.createElement("h2");

    question.className =
        "faq-question";

    question.textContent =
        faq.question || "";


    const summary =
        document.createElement("p");

    summary.className =
        "faq-summary";

    summary.textContent =
        faq.summary || "";


    questionContent.append(
        question,
        summary
    );


    const chevron =
        document.createElement("span");

    chevron.className =
        "faq-chevron";

    chevron.setAttribute(
        "aria-hidden",
        "true"
    );

    chevron.textContent =
        "⌄";


    questionButton.append(
        questionContent,
        chevron
    );


    main.append(
        voteContainer,
        questionButton
    );


    const answer =
        document.createElement("div");

    answer.className =
        "faq-answer";


    const answerText =
        document.createElement("p");

    answerText.textContent =
        faq.answer || "";


    answer.appendChild(
        answerText
    );


    item.append(
        main,
        answer
    );


    questionButton.addEventListener(
        "click",
        () => {

            toggleFaqItem(
                item,
                questionButton
            );

        }
    );


    upvoteButton.addEventListener(
        "click",
        async event => {

            event.stopPropagation();

            await handleFaqUpvote(
                faq,
                upvoteButton,
                voteCount
            );

        }
    );


    return item;

}


/*
=========================================================
EXPAND FAQ
=========================================================
*/

function toggleFaqItem(
    item,
    button
) {

    const expanded =
        item.classList.toggle(
            "expanded"
        );


    button.setAttribute(
        "aria-expanded",
        String(expanded)
    );

}


/*
=========================================================
UPVOTE
=========================================================
*/

async function handleFaqUpvote(
    faq,
    button,
    voteCount
) {

    const session =
        await getCurrentSession();


    if (!session) {

        showLoginPrompt(
            "Log in to upvote this FAQ.",
            {
                type:
                    "upvote",

                faqId:
                    faq.id
            }
        );

        return;

    }


    if (button.disabled) {

        return;

    }


    button.disabled =
        true;


    try {

        const response =
            await fetch(
                FAQ_UPVOTE_URL,
                {
                    method:
                        "POST",

                    credentials:
                        "include",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            {
                                faqId:
                                    faq.id
                            }
                        )
                }
            );


        if (
            response.status === 401 ||
            response.status === 403
        ) {

            showLoginPrompt(
                "Log in to upvote this FAQ.",
                {
                    type:
                        "upvote",

                    faqId:
                        faq.id
                }
            );

            return;

        }


        if (!response.ok) {

            throw new Error(
                `FAQ upvote failed: ${response.status}`
            );

        }


        const result =
            await response.json();


        voteCount.textContent =
            formatVoteCount(
                result.upvotes
            );


        button.classList.toggle(
            "voted",
            result.userUpvoted === true
        );

    }
    catch (error) {

        console.error(
            "Unable to update FAQ vote:",
            error
        );

    }
    finally {

        button.disabled =
            false;

    }

}


/*
=========================================================
SUGGEST FAQ
=========================================================
*/

function bindFaqSuggestion() {

    faqSuggestionButton.addEventListener(
        "click",
        async () => {

            const session =
                await getCurrentSession();


            if (!session) {

                showLoginPrompt(
                    "Log in before submitting an FAQ suggestion.",
                    {
                        type:
                            "suggestion"
                    }
                );

                return;

            }


            openSuggestionPage();

        }
    );

}


function openSuggestionPage() {

    window.location.href =
        FAQ_SUGGEST_URL;

}


/*
=========================================================
AUTHENTICATION
=========================================================
*/

async function getCurrentSession() {

    try {

        if (
            window.BPDAuth &&
            typeof window.BPDAuth.getSession
                === "function"
        ) {

            const session =
                await window.BPDAuth.getSession();

            return session || null;

        }


        const response =
            await fetch(
                "/api/auth/session",
                {
                    credentials:
                        "include",

                    cache:
                        "no-store"
                }
            );


        if (!response.ok) {

            return null;

        }


        const session =
            await response.json();


        if (
            !session ||
            session.authenticated !== true
        ) {

            return null;

        }


        return session;

    }
    catch {

        return null;

    }

}


/*
=========================================================
LOGIN PROMPT
=========================================================
*/

function showLoginPrompt(
    message,
    action
) {

    pendingAuthAction =
        action || null;


    faqLoginMessage.textContent =
        message;


    faqLoginModal.hidden =
        false;


    document.body.style.overflow =
        "hidden";


    faqLoginButton.focus();

}


function closeLoginPrompt() {

    faqLoginModal.hidden =
        true;


    document.body.style.overflow =
        "";


    pendingAuthAction =
        null;

}


/*
=========================================================
LOGIN MODAL EVENTS
=========================================================
*/

function bindLoginModal() {

    document
        .querySelectorAll(
            "[data-close-login]"
        )
        .forEach(
            element => {

                element.addEventListener(
                    "click",
                    closeLoginPrompt
                );

            }
        );


    faqLoginButton.addEventListener(
        "click",
        () => {

            beginLogin();

        }
    );


    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Escape" &&
                !faqLoginModal.hidden
            ) {

                closeLoginPrompt();

            }

        }
    );

}


/*
=========================================================
START LOGIN
=========================================================
*/

function beginLogin() {

    const returnUrl =
        window.location.pathname +
        window.location.search;


    const action =
        pendingAuthAction;


    if (action) {

        sessionStorage.setItem(
            "faqPendingAction",
            JSON.stringify(action)
        );

    }


    window.location.href =
        "/login?return=" +
        encodeURIComponent(
            returnUrl
        );

}


/*
=========================================================
UTILITIES
=========================================================
*/

function formatVoteCount(value) {

    const count =
        Number(value);


    if (!Number.isFinite(count)) {

        return "0";

    }


    return Math.max(
        0,
        Math.trunc(count)
    ).toLocaleString();

}