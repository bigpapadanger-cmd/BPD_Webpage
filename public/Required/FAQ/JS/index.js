/*
=========================================================
BPD GAMING NETWORK
FAQ PAGE
=========================================================
*/

import {
    BPD_AUTH_SESSION_URL
} from "/scripts/apiRoutes.js";

import { apiFetch } from "../../../scripts/apiConnection";

const FAQ_API_URL =
    "/api/faq";

const FAQ_UPVOTE_URL =
    "/api/faq/upvote";

const FAQ_SUGGEST_URL =
    "/faq/suggest";


let faqList = null;
let faqSuggestionButton = null;
let faqLoginModal = null;
let faqLoginMessage = null;
let faqLoginButton = null;

let pendingAuthAction = null;


/*
=========================================================
INITIALIZE PAGE
Called by SPA route initialization.
=========================================================
*/

export async function initializePage() {
    faqList =
        document.getElementById(
            "faqList"
        );

    faqSuggestionButton =
        document.getElementById(
            "faqSuggestionButton"
        );

    faqLoginModal =
        document.getElementById(
            "faqLoginModal"
        );

    faqLoginMessage =
        document.getElementById(
            "faqLoginMessage"
        );

    faqLoginButton =
        document.getElementById(
            "faqLoginButton"
        );

    if (!faqList) {
        console.error(
            "FAQ: FAQ list container was not found."
        );

        return;
    }

    bindFaqSuggestion();
    bindLoginModal();

    await loadFaqs();
}


/*
=========================================================
LOAD FAQ DATA
=========================================================
*/

async function loadFaqs() {
    try {
        const response =
            await apiFetch(
                FAQ_API_URL,
                {
                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "accept":
                            "application/json"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `FAQ request failed: ${response.status}`
            );
        }

        const result =
            await response.json();

        const faqs =
            Array.isArray(result)
                ? result
                : Array.isArray(
                    result?.faqs
                )
                    ? result.faqs
                    : [];

        renderFaqs(
            faqs
        );
    } catch (error) {
        console.error(
            "FAQ: Unable to load FAQs.",
            error
        );

        renderFaqs([]);
    }
}


/*
=========================================================
RENDER FAQ DATA
=========================================================
*/

function renderFaqs(faqs) {
    if (!faqList) {
        return;
    }

    faqList.replaceChildren();

    if (
        !Array.isArray(faqs) ||
        faqs.length === 0
    ) {
        renderEmptyFaqState();

        return;
    }

    const fragment =
        document.createDocumentFragment();

    faqs.forEach(
        function(faq) {
            const faqElement =
                createFaqElement(
                    faq
                );

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
EMPTY STATE
=========================================================
*/

function renderEmptyFaqState() {
    if (!faqList) {
        return;
    }

    const emptyState =
        document.createElement(
            "div"
        );

    emptyState.className =
        "faq-empty-state";


    const heading =
        document.createElement(
            "h2"
        );

    heading.textContent =
        "No FAQs yet";


    const description =
        document.createElement(
            "p"
        );

    description.textContent =
        "Frequently asked questions will appear here as they are added.";


    emptyState.append(
        heading,
        description
    );

    faqList.appendChild(
        emptyState
    );
}


/*
=========================================================
CREATE FAQ ITEM
=========================================================
*/

function createFaqElement(faq) {
    const item =
        document.createElement(
            "article"
        );

    item.className =
        "faq-item";

    item.dataset.faqId =
        String(
            faq?.id ?? ""
        );


    const main =
        document.createElement(
            "div"
        );

    main.className =
        "faq-item-main";


    /*
    =====================================================
    UPVOTE
    =====================================================
    */

    const voteContainer =
        document.createElement(
            "div"
        );

    voteContainer.className =
        "faq-vote";


    const upvoteButton =
        document.createElement(
            "button"
        );

    upvoteButton.type =
        "button";

    upvoteButton.className =
        "faq-upvote-button";

    upvoteButton.setAttribute(
        "aria-label",
        `Upvote ${
            faq?.question ||
            "FAQ"
        }`
    );

    upvoteButton.textContent =
        "▲";


    if (
        faq?.userUpvoted === true
    ) {
        upvoteButton.classList.add(
            "voted"
        );
    }


    const voteCount =
        document.createElement(
            "span"
        );

    voteCount.className =
        "faq-upvote-count";

    voteCount.textContent =
        formatVoteCount(
            faq?.upvotes
        );


    voteContainer.append(
        upvoteButton,
        voteCount
    );


    /*
    =====================================================
    QUESTION
    =====================================================
    */

    const questionButton =
        document.createElement(
            "button"
        );

    questionButton.type =
        "button";

    questionButton.className =
        "faq-question-button";

    questionButton.setAttribute(
        "aria-expanded",
        "false"
    );


    const questionContent =
        document.createElement(
            "div"
        );

    questionContent.className =
        "faq-question-content";


    const question =
        document.createElement(
            "h2"
        );

    question.className =
        "faq-question";

    question.textContent =
        faq?.question || "";


    const summary =
        document.createElement(
            "p"
        );

    summary.className =
        "faq-summary";

    summary.textContent =
        faq?.summary || "";


    questionContent.append(
        question,
        summary
    );


    const chevron =
        document.createElement(
            "span"
        );

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


    /*
    =====================================================
    ANSWER
    =====================================================
    */

    const answer =
        document.createElement(
            "div"
        );

    answer.className =
        "faq-answer";


    const answerText =
        document.createElement(
            "p"
        );

    answerText.textContent =
        faq?.answer || "";


    answer.appendChild(
        answerText
    );


    item.append(
        main,
        answer
    );


    /*
    =====================================================
    EVENTS
    =====================================================
    */

    questionButton.addEventListener(
        "click",
        function() {
            toggleFaqItem(
                item,
                questionButton
            );
        }
    );


    upvoteButton.addEventListener(
        "click",
        async function(event) {
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
    if (button.disabled) {
        return;
    }

    const session =
        await getCurrentSession();

    if (!session) {
        showLoginPrompt(
            "Sign in is required to upvote an FAQ.",
            {
                type:
                    "upvote",

                faqId:
                    faq?.id
            }
        );

        return;
    }

    button.disabled =
        true;

    try {
        const response =
            await apiFetch(
                FAQ_UPVOTE_URL,
                {
                    method:
                        "POST",

                    credentials:
                        "same-origin",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            {
                                faqId:
                                    faq?.id
                            }
                        )
                }
            );

        if (
            response.status === 401 ||
            response.status === 403
        ) {
            showLoginPrompt(
                "Sign in is required to upvote an FAQ.",
                {
                    type:
                        "upvote",

                    faqId:
                        faq?.id
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
                result?.upvotes
            );

        button.classList.toggle(
            "voted",
            result?.userUpvoted ===
                true
        );
    } catch (error) {
        console.error(
            "FAQ: Unable to update vote.",
            error
        );
    } finally {
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
    if (!faqSuggestionButton) {
        return;
    }

    if (
        faqSuggestionButton
            .dataset.initialized ===
        "true"
    ) {
        return;
    }

    faqSuggestionButton.addEventListener(
        "click",
        handleFaqSuggestion
    );

    faqSuggestionButton.dataset.initialized =
        "true";
}


async function handleFaqSuggestion() {
    const session =
        await getCurrentSession();

    if (!session) {
        showLoginPrompt(
            "Sign in is required before submitting an FAQ suggestion.",
            {
                type:
                    "suggestion"
            }
        );

        return;
    }

    openSuggestionPage();
}


function openSuggestionPage() {
    if (
        window.BPDRouter &&
        typeof window.BPDRouter.navigate ===
            "function"
    ) {
        window.BPDRouter.navigate(
            FAQ_SUGGEST_URL
        );

        return;
    }

    window.location.assign(
        FAQ_SUGGEST_URL
    );
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
            typeof window.BPDAuth.getSession ===
                "function"
        ) {
            const session =
                await window.BPDAuth.getSession();

            if (
                session?.authenticated !==
                true
            ) {
                return null;
            }

            return session;
        }

        const response =
            await apiFetch(
                BPD_AUTH_SESSION_URL,
                {
                    credentials:
                        "same-origin",

                    cache:
                        "no-store",

                    headers: {
                        "accept":
                            "application/json"
                    }
                }
            );

        if (!response.ok) {
            return null;
        }

        const session =
            await response.json();

        if (
            session?.authenticated !==
            true
        ) {
            return null;
        }

        return session;
    } catch (error) {
        console.error(
            "FAQ: Authentication check failed.",
            error
        );

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
    if (
        !faqLoginModal ||
        !faqLoginMessage
    ) {
        console.error(
            "FAQ: Login modal elements were not found."
        );

        return;
    }

    pendingAuthAction =
        action || null;

    faqLoginMessage.textContent =
        message;

    faqLoginModal.hidden =
        false;

    document.body.style.overflow =
        "hidden";

    resetLoginButton();

    if (faqLoginButton) {
        faqLoginButton.focus();
    }
}


function closeLoginPrompt() {
    if (!faqLoginModal) {
        return;
    }

    faqLoginModal.hidden =
        true;

    document.body.style.overflow =
        "";

    pendingAuthAction =
        null;

    resetLoginButton();
}


/*
=========================================================
LOGIN MODAL EVENTS
=========================================================
*/

function bindLoginModal() {
    if (!faqLoginModal) {
        return;
    }

    if (
        faqLoginModal
            .dataset.initialized ===
        "true"
    ) {
        return;
    }

    faqLoginModal
        .querySelectorAll(
            "[data-close-login]"
        )
        .forEach(
            function(element) {
                element.addEventListener(
                    "click",
                    closeLoginPrompt
                );
            }
        );

    if (faqLoginButton) {
        faqLoginButton.addEventListener(
            "click",
            beginLogin
        );
    }

    faqLoginModal.addEventListener(
        "keydown",
        function(event) {
            if (
                event.key ===
                "Escape"
            ) {
                closeLoginPrompt();
            }
        }
    );

    faqLoginModal.dataset.initialized =
        "true";
}


/*
=========================================================
START LOGIN
Shared FAQ sign-in flow has not been developed yet.
=========================================================
*/

function beginLogin() {
    if (!faqLoginMessage) {
        return;
    }

    faqLoginMessage.textContent =
        "Sign-in from the FAQ is not available yet. Authentication for this feature will be added as the account system is developed.";

    if (faqLoginButton) {
        faqLoginButton.disabled =
            true;

        faqLoginButton.textContent =
            "Sign In Unavailable";
    }
}


/*
=========================================================
RESET LOGIN BUTTON
=========================================================
*/

function resetLoginButton() {
    if (!faqLoginButton) {
        return;
    }

    faqLoginButton.disabled =
        false;

    faqLoginButton.textContent =
        "Sign In";
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