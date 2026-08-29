import { 
    renderHeader 
} from "/Framework/Shell/JS/renderHeader.js"; 

const arkPanels = 
    document.querySelectorAll( 
        "[data-ark-panel]" 
    ); 

renderHeader({
    eyebrow: "BPD GAMING NETWORK",

    title: "ARK",

    tabs: [
        {
            label: "Mods",
            href: "/ARK?tab=mods"
        },
        {
            label: "Announcements",
            href: "/ARK?tab=announcements"
        }
    ]
});


function renderArkPanel() { 

    const params = 
        new URLSearchParams( 
            window.location.search 
        ); 

    const tab = 
        params.get("tab") || 
        "mods"; 


    arkPanels.forEach( 
        panel => { 

            panel.hidden = 
                panel.dataset.arkPanel !== tab; 

        } 
    ); 

} 


function navigateArkTab( 
    tab 
) { 

    const url = 
        new URL( 
            window.location.href 
        ); 

    url.searchParams.set( 
        "tab", 
        tab 
    ); 

    window.history.pushState( 
        {}, 
        "", 
        url 
    ); 

    renderArkPanel(); 
} 


function initializeArkTabs() { 

    document 
        .querySelectorAll( 
            "[data-header-tab]" 
        ) 
        .forEach( 
            tab => { 

                tab.addEventListener( 
                    "click", 
                    () => { 

                        navigateArkTab( 
                            tab.dataset.headerTab 
                        ); 

                    } 
                ); 

            } 
        ); 

} 


initializeArkTabs(); 

renderArkPanel(); 

window.addEventListener( 
    "popstate", 
    renderArkPanel 
);