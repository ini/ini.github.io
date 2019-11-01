function checkScroll() {
    var startY = $(".navbar").height() * 2;

    if ($(window).scrollTop() <= startY) {
        $(".navbar").addClass("at-top");
    } else {
        $(".navbar").removeClass("at-top");
    }
}

$(window).on("scroll load resize", function() {
    checkScroll();
});