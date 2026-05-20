## Table Of Contents
- [Introduction](#jardesigner-documentation)
- [Quick Overview](#quick-overview)
- [Handling Paths](#handling-paths)
  - [Electrical Model Paths](#electrical-model-paths)
  - [Chemical Model Paths](#chemical-model-paths)
    - [Molecule Paths](#molecule-paths)
- [The 3D display](#the-3d-display)
- [Menu Boxes](#details-of-each-menu-box)
- [Top-Level Fields](#top-level-fields)


# Jardesigner Documentation

Jardesigner stands for **J**avascript **A**pp for **R**eaction **D**iffusion 
and **E**lectrical **SIG**naling in **NE**u**R**ons. It combines three things: 

A *format* for specifying multiscale models, 

The MOOSE-based *model simulator* which loads and runs models in the 
jardesigner.json format, 

and a *Graphical User Interface* to generate and run models using the first two.

This document explains how to use the jardesigner GUI to build and run
multiscale neuronal models.


**Load-and-Run Workflow**:

1. Load models using the *File* Menu box: Either your own models, or tutorials.

2. Run models using the *Run* Menu box

3. View model properties and simulation output in the right-hand window, 
under the tabs for Graph, Model Json and so on.

4. Save model output by clicking on the hover-over download button in the graphs.


**Build-and-Edit Workflow**:

1. Start with the menu box for Morphology. Then add spines, channels and so on.

2. In *Spines*, *Channels*, and *Signaling* there is a common pattern: You pick a set of prototypes, then distribute them over the cell.

3. The GUI follows a "Refresh-to-update" pattern. Your changes are activated after you go to a new MenuBox, or close the current one.

4. The current configuration of the model appears as a 3D cell and icons for various controls, in the *Setup 3D* tab of the right-hand window. It also appears in JSON format in the *Model Json* tab.

5. You can go back to any MenuBox to edit values.

6. Run and view simulation output, and save model output as before

7. Save model using the *File* Menu box.


# Quick overview

Here I provide a quick worked example of building a multiscale model.
While you do this, flip between the current *DOCUMENTATION* tab and the
*MODEL JSON*  tab on the right so you can see how your model takes shape.
Click on the *SHOW MODEL JSON* button at any point to refresh the view of the
developing JSON structure. 

1. **Pick cell Morphology**: Go to the *Morphology* item and select a shape, 
such as the Y-branch. Change the dendrite length to 50 microns. The JSON tab
should look something like this:

```
    {
        "filetype": "jardesigner",
        "version": "1.0",
        "cellProto": {
            "type": "branchedCell",
            "somaDia": 0.00001,
            "somaLen": 0.00001,
            "dendDia": 0.000005,
            "dendLen": 0.00005,
            "dendNumSeg": 1,
            "branchDia": 0.0000025,
            "branchLen": 0.00015,
            "branchNumSeg": 1
        }
    }
```

2. **Add Spines**: In the *Spines* tab we'll use the default Excitatory 
prototype. Go down to the *Distributions* panel and pick "exc" from the 
pulldown menu for "prototypes". Set the *Path* to "#". This is a wildcard
specifier that means to put spines on every compartment.
The rest of the items can remain defaults.

3. **Add Channels**: This time we'll get more elaborate about how to build
complex components using multiple prototypes. Note that it is advisable to 
build *all* of your required prototypes before you assign their distributions, 
lest you accidentally overwrite a prototype which is already in use. 

	3.1. Open the *Channels* tab. 

	3.2. From the dropdown menu pick "Na". Leave its name as the default "Na"

	3.3. Click the *+* tab to open up another prototype.

	3.4. Pick "KDR". 

	3.5. Next go down to the *Distribution* section of the same window. 

	3.6. Pick "Na" from the menu, and set its conductance to 1000. 

	3.7. Click *+* to open up another distribution.

	3.8. Pick "KDR" and set its Gbar to 1400.

To have a look at what you've done so far, click on the *SHOW MODEL JSON* button
in the right panel to see how all these prototypes and distributions are set up.

4. **Add Stimulus**: We'll now jump ahead to the stimulus so as to get some
intermediate positive reinforcement. Go to the "Stimuli" menu box. Note that
there is the familiar tabbed layout, so you can put in as many stimuli as 
you need.

	4.1. Enter "soma" into the Path. This defines where this stimulus will go.

	4.2. Leave the *Type* menu at the default value of "Field"

	4.3. Select *Field* menu item "inject". 

	4.4. Enter into the *Stimulus Expr* the value "0.1e-9*(t>0.1)*(t<0.2)" 
(without quotes). 

Overall this stimulus means: "into the *soma*, *inject* 0.1 nanoamp during 
the interval 0.1 to 0.2 seconds.

5. **Add Plot**: In the *PLOTS* menu enter *soma* again as the path. You can set a title such as "Soma Vm (mV)"

6. **Run it**: Finally, open the *Run* tab. All the defaults are fine. Just
click the green "START" button.

7. **3D display it**: For some more dopamine, set it up in the 3-D display. 
[This may not yet be enabled for the remote web display, in which case
skip this step]. Open the *3D* menu box.
	
	7.1. Set Path to #. This is a wildcard which means to display all the compartments.

	7.2. Go down to the *Global Display Settings* and set the *Display dt* to
a reasonable 0.0005. This lets us detect individual action potentials.

	7.3. Go back to the *Run* tab and hit *START* again. 

	7.4. A new tab should appear in your browser with a 3-D rendering of 
the cell in it. Use your right and left mouse buttons to twirl the display
and the scroll bar to zoom in and out. You should be able to see individual 
spines.  You can also click the "Start Replay" button so it loops through the 
output till you click it again. 

	7.5. Close the 3D tab. The graph of the simulation should now appear
in the usual jardesigner interface.

At this point our model is entirely electrical. Before we go any further, let's
save it.

8. **Save Model**: Go to the *File* menu, change the suggested file name to "elec\_model1.json.. Fill in your name and any notes and hit "Save Model"


9. **Add Signaling**:  To go multiscale, let's put in some chemistry. Open the
*Signaling* menu. We'll use the default Oscillator prototype. 

	9.1. Go down to the *Distributions* section and select "Oscillator". 

	9.2. We're going to put this in all the dendrite compartments. Enter "dend#". Actually we only have one dendrite compartment by default and it is dend0,
but using the wildcard means we don't have to worry about how many dendrite compartments there are.

	9.3. You need to pick a diffusion length. We'll go with 2 microns.

10. **Add plots for Signaling**: This is a bit more involved than the voltage 
plot, because we need to specify the chemical molecules rather than Vm.
	
	10.1. Go to the *Plots* menu. 

	10.2. Click the *+" tab so that you create a new plot, not just overwrite the voltage plot you already made.

	10.3. In the new tab, set Path = "dend#" so that we get all the 
_chemical_ subdivisions of the dend compartment. These divisions may differ 
from the electrical ones.

	10.4. Specify the field "conc" from the pulldown menu.

	10.5. Select "Oscillator" from the *Chem Prototype*. It is the only option as we have only defined the one chemical prototype.

	10.6. Enter "a" (no quotes) in the *Child Object Path*. This means that
we want to plot the concentration of molecule a.


11. **Change 3D display**: The current 3D display shows Vm at 0.5 ms interval.
This will take a very long time to display as the model now has to run 50 
seconds. So let's view the chemical signals instead.

	11.1. Set the Runtime in the *3D -> Global Display Settings* to 50

	11.2. Set the Display dt to 1 
second

	11.3. Set the *Field* to "conc"

	11.4. Like for the plot, set the *Chem Prototype* to "Oscillator"

	11.5. Set the *Child Object Path* to "a"

	11.6. Set Max to 200. This is the max concentration.

	
12. **Run it**: Change the *Total Runtime* to 50 seconds, and click *START*.

If the 3-D display is running, you'll see a plump sausage changing colours.
If you remember, we had only populated the dendrite with the chemical system,
so this is all that it displays. Once the 3D display has run its course, close
the window and you'll see the decaying oscillations of the chemical system,
as well as the very brief initial burst of spikes from the electrical system.

So far we just have a single model in which chemical events and electrical
events play out quite independently of each other. To make this multiscale,
we now send the output of the chemical model as a current injection into the
electrical model. This is totally ad-hoc, but illustrates the point. To do this,
we use *Adaptors*.

13. **Make Adaptor**: Select the *ADAPTORS* menu.

	13.1.	*Source Path is the molecule. Set it to "Ocsillator/a"

	13.2.	*Destination Path* is the current electrical compartment. Set this to "." (no quotes), to state that it is the current path.

	13.3.	*Source Field* is "conc" (no quotes)

	13.4.	*Destination Field* is "inject" (no quotes)

	13.5.	*Baseline* is the offset. Leave it at the default 0

	13.6.	*Slope* converts from molecules (with a range of 200) to current (with a range of 1e-10). So the slope should be 150e-12 so we get a decent swing each way.

	13.7.	Run it again, see how the signaling controls spiking.

14. **Chemical Stimulus**: Finally, we give the chemical system a bit of 
symmetry breaking to show its actual spatial extent. To do this, we change the
initial conditions at one end of the dendrite.

	14.1.	Open *STIMULI* and click the *+* to create a new tab

	14.2.	Set *Path* = dend#

	14.3.	Set *Field* menu item to conc

	14.4.	Set *Chem Prototype* to Oscillator

	14.5.	Set *Child Object Path* to a[0]

	14.6.	Set *Stimulus Expr* to 2*(t<1). In other words, look at the 
dendrite compartments, initialize the chemical species a in subcompartment 0 
to be 2 mM at from t = 0 to 1, and then zero.

	14.7.	Run it. Behold the interesting propagation of activity in the 
3-D view, and check the time-series plots to see how the level of molecule 
**a** in turn modulates the firing of the cell.


-------------------------------------------------------------

# Handling paths

Paths are used to point to subcompartments of a model. The basics look a lot
like the Unix file system with a few extensions. 


## Electrical model paths

Here are the paths for the predefined elecrical models:

| Model type | Paths | Indexing |
| --- | --- | --- |
| `soma` | soma | Always only a single soma compartment. |
| `ball and stick` | soma | Always a single compartment |
| `ball and stick` | dend0..N-1 | The dend compartment is subdivided into *numSegments*, indicated here by N. Indices are directly appended onto the dendrite path |
| `Y branch model` | soma | Always a single compartment |
| `Y branch model` | dend0..N-1  | Same as for ball and stick model |
| `Y branch model` | branch1\_0..B-1 | Similar to the dendrite, there are *numSegments* for each branch |
| `Y branch model` | branch2\_0..B-1  | See above. |
| `Model from swc file`| soma | Possible to have multiple indices here! |
| `Model from swc file`| other branches | Arbitrary naming schemes. |
| `Spine head on added spines`| head0..S-1| The number of spines S is sutomatically calculated from the spacing of spines, and the length of dendrite on which they sit. |
| `Spine shaft on added spines`| shaft0..H-1| Same as above. One normally doesn't do much with teh spine shafts. |


If you want to refer to all segments within a dendrite, use the wildcard **#**
character, for example:

```
	dend#
```

You can separate multiple paths with a comma, but no spaces. For example,
here are two ways to indicate the most proximal branches of a Y branch cell:

```
	branch1_0,branch2_0

	branch#_0
```

If you want to select all the electrical compartments then:

```
	#
```

is enough.

Relative paths point to objects nested under the compartments. For example,
the Na ion channel on the soma will be located at **soma/Na**. When accessing
the relative paths the dialogs do not need the intervening /.

## Chemical model paths

Things get more involved for paths for reactions. 

1. For starters, at present the molecule names are not obvious.
We need a separate interface to even see the reaction scheme, though this
will eventually come into this GUI. Thus you have to know ahead of time what
are the names of the molecules you want to access.

2. Reaction systems always live within a chemical compartment defined by their
prototype. For example, the molecules in the default *Oscillator* chem model
are:

``` 

	Oscillator/a
	Oscillator/b
	Oscillator/s

``` 

Thus in the examples above we specify the prototype name (Oscillator) and then
the molecules beneath it.

Where are molecules placed? This is complicated. Consider the items in the
**SIGNALING** menu, under the *Distributions* section.

1. *Path*: First, all molecules must live within the spatial bounds defined by 
an electrical compartment. Here you have to put in an electrical compartment
path as indicated above.

2. *Location*: Second, even within a given electrical compartment, the molecule
could be in one of several diffusively coupled locations. 

	2.1.	*Dendrite*: within the cytoplasm of the dendrite.

	2.2	*Spine*: This must be placed within a spine head

	2.3	*PSD*: This must be placed within a spine head

	2.4	*Endo*: This must be placed within a dendrite, and is a series of intracellular compartments. Useful for CICR models.

	2.5	*Presyn_spine*: This must be placed within a spine head

	2.6	*Presyn_dend*: This must be placed within a dendrite


### Molecule paths

If you want to plot or 3-D display or connect to a molecule for stimulus
or adaptor, you need to access the precise index (or wildcard) for that 
molecule. Molecules obey a slightly different rule for indexing. 

1. They are always within a chemical sub-compartment, for example *Oscillator* in several
examples. This is fortunately separated out for you in the dialogs.

2. They are indexed as *molecule[0..N-1]* where N depends on where they are 
placed.

	2.1. In a dendrite and Presyn_dend, N is the ratio of the length of the dendrite to the diffusion length

	2.2. In a spine, PSD, or Presyn_spine, N is the number of spine-heads.

	2.3. In an endo compartment we directly specify the spacing between them.

# The 3D display

MOOGLI is the MOOSE Graphical Interface. It uses Vpython to drive a WebGL
display in your browser. At present it does *not* display in the same 
React interface as the rest of the jardesigner interface, but arguably it 
benefits from more screen space in the current arrangement. The drawback is
that it isn't yet possible to work in client-server mode with a separate
server machine.

Here is a short primer on the 3-D display controls.

- Mouse right button causes rotation around center.
- Mouse scroll wheel causes zooming in or out.
- Shift-mouseleft button causes the image to be dragged around
  left/right and up/down.
- *Roll, pitch, and yaw*: Use the letters *r*, *p*, and *y*. To rotate
  backwards, use capitals.
- *Zoom out and in*: Use the *,* and *.* keys, or their upper-case
  equivalents, *<* and *>*. Easier to remember if you think in terms of
  the upper-case.
- *Left/right/up/down*: Arrow keys.
- *Display and center All*: **a** key.
- *Diameter scaling*: Capital **D** makes the diameter larger, small **d**
  makes it smaller. Useful to visualize thin-diameter dendrites. Note that
  it does not reposition spines, they will get engulfed if you make the
  diameter too big.
- *Quit*: control-q or control-w.
- You can also use the mouse or trackpad to control most of the above.
- Rdesigneur can also give Moogli a small rotation each frame. It is
  the *rotation* argument in the line:

   ``displayMoogli( frametime, runtime, rotation )``

These controls operate over and above this rotation, but the rotation
continues while the simulation is running.

Moogli displays a few additional items:

- The name of the variable in the top left and above the colorbar.
- The current simulation time, above the colorbar.
- A slider with the wait time for each frame, when in replay mode.
- A button to activate replay mode. This becomes enabled after the simulation
  completes. When pushed, this causes the Moogli display to cycle through the
  entire simulation, at a frame rate determined by the slider. This is very
  handy to play back a simulation at a faster (or slower) rate than the
  original calculation.
- A colorbar on the left.
- At the bottom left there is a small axis with a scale value just above it.
  The three axes are x: red; y: green and z: blue. The length of each axis
  is indicated just above. The nominal position of this axis is the centre of
  rotation of the image. Due to peculiarities in how Vpython passes events,
  the scale axes are updated only during replay, or when the user clicks or
  does a keyboard control event in the display.



# Details of each menu box

To be filled


This document explains the structure and key fields of the `model.json` file used in this application.

# Top-Level Fields

The JSON model has several primary keys that control the simulation.

| Key | Type | Description |
| --- | --- | --- |
| `runtime` | number | The total simulation time in seconds. |
| `elecDt` | number | The time step for electrical calculations. |
| `turnOffElec`| boolean | If `true`, electrical simulations are disabled. |

---