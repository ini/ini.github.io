function myFunction() {
      document.getElementById("demo").innerHTML = "Paragraph changed.";
}

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

if($(".navbar").length > 0) {
	document.getElementById("demo").innerHTML = "checkers";
    $(window).on("scroll load resize", function() {
        checkScroll();
    });
}
